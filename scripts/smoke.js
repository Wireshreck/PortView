'use strict';

/**
 * Starts the server on a free port, waits for it to answer, checks the page
 * and the API, then shuts it down again.
 *
 * This is what CI runs, and it works the same way on Windows, macOS and Linux
 * because there is no shell involved. Run it yourself with:
 *
 *   node scripts/smoke.js
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.SMOKE_PORT || 6979);
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 30000;

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const res = await get(`${BASE}/api/state`);
      if (res.status === 200) return;
    } catch (_) {
      // Not up yet.
    }
    await sleep(300);
  }

  throw new Error(`server did not answer on ${BASE} within ${TIMEOUT_MS}ms`);
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });

  let failed = false;
  try {
    await waitForServer();
    console.log(`server is up on ${BASE}`);

    const page = await get(`${BASE}/`);
    check(page.status === 200, `GET / returned ${page.status}`);
    check(/PortView/.test(page.body), 'GET / did not return the viewer page');

    const state = await get(`${BASE}/api/state`);
    check(state.status === 200, `GET /api/state returned ${state.status}`);

    let parsed;
    try {
      parsed = JSON.parse(state.body);
    } catch (_) {
      throw new Error('GET /api/state did not return JSON');
    }
    check('status' in parsed, 'GET /api/state is missing "status"');
    check(Array.isArray(parsed.open), 'GET /api/state is missing the open port list');
    check(typeof parsed.openCount === 'number', 'GET /api/state is missing "openCount"');

    const names = await get(`${BASE}/api/names`);
    check(names.status === 200, `GET /api/names returned ${names.status}`);

    // The login shortcut relies on a second copy stepping aside quietly when
    // this one already owns the port.
    const twin = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--startup'], {
      env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
      stdio: 'ignore',
    });
    const twinCode = await new Promise((resolve) => {
      const timer = setTimeout(() => { twin.kill(); resolve('timeout'); }, 10000);
      twin.on('exit', (code) => { clearTimeout(timer); resolve(code); });
    });
    check(twinCode === 0, `a second --startup instance exited with ${twinCode}, expected 0`);

    console.log(`viewer answers, ${parsed.openCount} open ports, status "${parsed.status}"`);
    console.log('smoke test passed');
  } catch (err) {
    failed = true;
    console.error(`smoke test failed: ${err.message}`);
    if (output.trim()) console.error(`\nserver output:\n${output.trim()}`);
  } finally {
    server.kill();
    // Give the child a moment to exit before the process ends.
    await sleep(200);
  }

  process.exit(failed ? 1 : 0);
}

main();
