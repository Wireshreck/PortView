'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const MAX_BODY = 64 * 1024;

/**
 * Fetch a page and pull out the interesting bits: title, content type and
 * whether the port is really speaking HTTP.
 *
 * Never rejects - a port that is not a web server simply returns null.
 */
function fetchInfo(url, timeout) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch (_) {
      return resolve(null);
    }

    const mod = target.protocol === 'https:' ? https : http;
    let settled = false;

    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let req;
    try {
      req = mod.get(
        url,
        {
          timeout,
          headers: {
            'User-Agent': 'PortView/1.0',
            Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
            Connection: 'close',
          },
        },
        (res) => {
          const status = res.statusCode || 0;
          const contentType = String(res.headers['content-type'] || '');
          const location = res.headers.location;
          const headers = {
            server: res.headers.server,
            'x-powered-by': res.headers['x-powered-by'],
          };

          // Do not follow redirects, just record them.
          if (status >= 300 && status < 400 && location) {
            res.resume();
            return done({ status, contentType, redirect: location, ...headers });
          }

          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            if (body.length < MAX_BODY) body += chunk;
            if (body.length >= MAX_BODY) {
              res.destroy();
              done(buildInfo(status, contentType, body, headers));
            }
          });
          res.on('end', () => done(buildInfo(status, contentType, body, headers)));
          res.on('error', () => done(buildInfo(status, contentType, body, headers)));
        }
      );
    } catch (err) {
      return done(null);
    }

    req.on('timeout', () => {
      req.destroy();
      done(null);
    });
    req.on('error', () => done(null));
  });
}

function buildInfo(status, contentType, body, headers) {
  const title = extractTitle(body || '');

  return {
    status,
    contentType,
    title,
    server: (headers && headers.server) || null,
    poweredBy: (headers && headers['x-powered-by']) || null,
    isHtml: /text\/html/i.test(contentType),
  };
}

/**
 * Pull the page title out of the HTML.
 *
 * Comments and scripts are stripped first: plenty of pages mention "<title>"
 * in their markup, and a naive regex picks that up instead of the real one.
 */
function extractTitle(html) {
  const cleaned = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const match = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(cleaned);
  if (!match) return null;

  const title = decodeEntities(match[1]).replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!title) return null;

  // Error pages say "Not Found" or "Bad Request" - that is not a name.
  if (/^(bad request|not found|forbidden|unauthorized|service unavailable|internal server error|error|404|403|500)$/i.test(title)) {
    return null;
  }

  // Neither is a title that says nothing at all.
  if (/^(index|home|document|untitled|localhost|new tab|loading|react app|vite app|welcome to .*)$/i.test(title)) {
    return null;
  }

  return title;
}

function decodeEntities(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Try to identify an HTTP service on a port.
 *
 * Tries http:// first and https:// second, because a TLS listener will fail
 * the plain request and vice versa.
 */
async function detectWeb(port, host, timeout = 900) {
  const hosts = [];
  for (const h of [host, 'localhost']) {
    if (h && !hosts.includes(h)) hosts.push(h);
  }

  for (const h of hosts) {
    for (const scheme of ['http', 'https']) {
      const bracket = h.includes(':') ? `[${h}]` : h;
      const info = await fetchInfo(`${scheme}://${bracket}:${port}/`, timeout);
      if (!info) continue;

      const looksLikeWeb =
        info.title ||
        /text\/html|application\/(json|xml|xhtml)|text\/plain|text\/javascript/i.test(info.contentType);

      if (looksLikeWeb) return { ...info, scheme, host: h };
    }
  }
  return null;
}

module.exports = { detectWeb, fetchInfo, extractTitle };
