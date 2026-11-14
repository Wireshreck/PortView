'use strict';

const net = require('net');
const dgram = require('dgram');
const os = require('os');

/**
 * Resolve a user-facing target into the list of hosts (address strings) to probe.
 */
function resolveHosts(target) {
  const t = String(target || 'localhost').trim().toLowerCase();

  if (t === 'localhost' || t === 'loopback' || t === 'this') {
    // Cover both stacks: a service bound only to ::1 is invisible from 127.0.0.1.
    return ['127.0.0.1', '::1'];
  }
  if (t === 'lan' || t === 'network' || t === 'subnet') {
    return lanAddresses();
  }
  if (t === 'all' || t === '*') {
    return [...lanAddresses(), '127.0.0.1', '::1'];
  }
  return [t];
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    for (const addr of list || []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
    }
  }
  return out;
}

function buildPortList(set, start, end) {
  const lo = clampPort(start);
  const hi = clampPort(end);
  switch (set) {
    case 'common': {
      const { COMMON_PORTS } = require('./services');
      return [...new Set(COMMON_PORTS)];
    }
    case 'wellknown':
      return range(1, Math.min(1023, hi));
    case 'registered':
      return range(Math.max(1024, lo), Math.min(49151, hi));
    case 'dynamic':
      return range(Math.max(49152, lo), Math.min(65535, hi));
    case 'range':
    case 'custom':
    default:
      return range(lo, hi);
  }
}

function clampPort(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return 1;
  return Math.min(65535, Math.max(1, Math.floor(n)));
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/**
 * Single TCP connect probe.
 * Resolves { port, host, open, reason?, localAddress? }
 */
function checkTcp(host, port, timeout) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (open, extra) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({ port, host, open, ...extra });
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => {
      const info = { localAddress: socket.localAddress, localPort: socket.localPort };
      done(true, info);
    });
    socket.once('timeout', () => done(false, { reason: 'timeout' }));
    socket.once('error', (err) => done(false, { reason: err.code || err.message }));

    socket.connect(port, host);
  });
}

/**
 * Single UDP probe. Connected UDP sockets surface ICMP port-unreachable as an
 * error on most platforms, which lets us distinguish closed from filtered.
 *
 * A port is only reported as open when it actually answers: UDP has no
 * handshake, so silence proves nothing.
 */
function checkUdp(host, port, timeout) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;

    const done = (state, extra) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch (_) { /* already closed */ }
      resolve({ port, host, open: state === 'open', state, ...extra });
    };

    socket.on('error', (err) => {
      if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') {
        done('closed', { reason: err.code });
      } else {
        // Some other error (no route, refused by policy) -> treat as filtered.
        done('filtered', { reason: err.code || err.message });
      }
    });

    socket.on('message', () => done('open', { reason: 'response' }));

    try {
      socket.connect(port, host, () => {
        try {
          // Zero-length datagram is enough to elicit an ICMP reply.
          socket.send(Buffer.alloc(0), () => {});
        } catch (err) {
          done('filtered', { reason: err.message });
        }
      });
    } catch (err) {
      done('filtered', { reason: err.message });
    }

    setTimeout(() => done('filtered', { reason: 'no-response' }), timeout);
  });
}

/**
 * Scan a list of hosts x a list of ports.
 *
 * opts: { concurrency, timeout, protocol, onOpen, onProgress, isCancelled }
 */
async function scan(hosts, ports, opts = {}) {
  const {
    concurrency = 500,
    timeout = 600,
    protocol = 'tcp',
    onOpen,
    onProgress,
    isCancelled = () => false,
  } = opts;

  const jobs = [];
  for (const host of hosts) {
    for (const port of ports) jobs.push({ host, port });
  }

  const total = jobs.length;
  let scanned = 0;
  let cursor = 0;

  const probe = protocol === 'udp' ? checkUdp : checkTcp;

  async function worker() {
    for (;;) {
      if (isCancelled()) return;
      const idx = cursor++;
      if (idx >= jobs.length) return;
      const { host, port } = jobs[idx];

      let result;
      try {
        result = await probe(host, port, timeout);
      } catch (err) {
        result = { port, host, open: false, reason: err && err.message };
      }

      scanned++;
      if (result.open) {
        try { onOpen && onOpen(result); } catch (_) { /* listener errors are non-fatal */ }
      }
      if (scanned % 250 === 0 || scanned === total) {
        try { onProgress && onProgress({ scanned, total }); } catch (_) { /* ignore */ }
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, total));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { scanned, total };
}

module.exports = {
  resolveHosts,
  lanAddresses,
  buildPortList,
  checkTcp,
  checkUdp,
  scan,
};
