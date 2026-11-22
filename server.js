'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { scan, resolveHosts, buildPortList, lanAddresses, checkTcp } = require('./scanner');
const { listSockets, candidatePorts, pickSocket, mapProcessNames, mapProcessCommands, detectProject, describeHost } = require('./process-lookup');
const { detectWeb } = require('./web-detect');
const portNames = require('./port-names');
const {
  createStore: createLauncherStore,
  keyOf: launcherKeyOf,
  parseCommandLine,
  unwrapShell,
  normalizeCommand,
  isSystemImage,
  looksSensitive,
  inferCwd,
  isDirectory,
  findExecutable,
} = require('./launchers');
const {
  catalogFor,
  serviceFor,
  labelFor,
  sectionFor,
  isWebPort,
  schemeFor,
  processLabel,
  frameworkLabel,
  SECTION_ORDER,
  SECTION_LABELS,
  SECTION_DESCRIPTIONS,
} = require('./services');

const PORT = Number(process.env.PORT || 6969);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const state = {
  status: 'idle', // idle | scanning | complete | cancelled | error
  target: 'localhost',
  hosts: ['127.0.0.1', '::1'],
  protocol: 'tcp',
  portSet: 'all',
  startPort: 1,
  endPort: 65535,
  total: 0,
  scanned: 0,
  open: [], // array of port entries
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  error: null,
  runId: 0,
  hostInfo: describeHost(),
  local: true,
  deep: true,
  lastOptions: null,
  sectionOrder: SECTION_ORDER,
  sectionLabels: SECTION_LABELS,
  sectionDescriptions: SECTION_DESCRIPTIONS,
};

const clients = new Set();
const recentLogs = [];
const launchers = createLauncherStore();
const launches = new Map(); // "port/proto" -> { pid, at, command }
let cancelFlag = false;
let watchTimer = null;

function log(line, level = 'info') {
  const entry = { t: Date.now(), level, line };
  recentLogs.push(entry);
  if (recentLogs.length > 200) recentLogs.splice(0, recentLogs.length - 200);
  broadcast('log', entry);
  const tag = level === 'error' ? 'ERR ' : level === 'warn' ? 'WARN' : 'INFO';
  console.log(`[${tag}] ${line}`);
}

/* ------------------------------------------------------------------ *
 * SSE plumbing
 * ------------------------------------------------------------------ */

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch (_) { clients.delete(res); }
  }
}

function snapshot() {
  return {
    ...state,
    openCount: openCount(),
    open: [...state.open].sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol)),
  };
}

/* ------------------------------------------------------------------ *
 * Local address detection
 * ------------------------------------------------------------------ */

function localAddressSet() {
  const set = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::']);
  for (const a of lanAddresses()) set.add(a);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list || []) set.add(addr.address);
  }
  return set;
}

const LOCAL_ADDRESSES = localAddressSet();

function isLocalHost(host) {
  return LOCAL_ADDRESSES.has(String(host).toLowerCase());
}

/* ------------------------------------------------------------------ *
 * Port entries
 * ------------------------------------------------------------------ */

function upsertPort(port, host, protocol, kind) {
  const key = `${port}/${protocol}`;
  let entry = state.open.find((e) => `${e.port}/${e.protocol}` === key);
  if (!entry) {
    entry = {
      port,
      protocol,
      service: serviceFor(port),
      label: null,
      custom: false,
      title: null,
      project: null,
      projectPath: null,
      framework: null,
      section: sectionFor(port),
      url: null,
      web: isWebPort(port),
      addresses: [],
      pid: null,
      process: null,
      listenAddress: null,
      // 'listening' = the OS reports a listening socket for this port
      // 'open'      = a TCP probe completed successfully
      state: kind === 'listening' ? 'listening' : 'open',
    };
    state.open.push(entry);
  }
  if (kind === 'listening' && entry.state !== 'listening') entry.state = 'listening';
  if (host && !entry.addresses.includes(host)) entry.addresses.push(host);
  return entry;
}

/**
 * Apply names to every known port.
 *
 * Precedence: a name you set yourself, then the page title of the service,
 * then the built-in catalogue, then the process that owns it.
 */
function decorateEntries() {
  const custom = portNames.all();
  const remembered = launchers.all();

  // Drop the placeholders for named ports that are not currently open, they
  // are added back below.
  state.open = state.open.filter((e) => !e.placeholder);

  for (const entry of state.open) {
    const mine = custom[String(entry.port)] || null;

    entry.service = serviceFor(entry.port);
    entry.custom = !!(mine && mine.label);
    entry.title = entry.title || null;

    // The most specific name wins: what you called it, then what the app
    // calls itself, then the project it lives in, then the catalogue.
    const fallback =
      labelFor(entry.port) ||
      entry.framework ||
      entry.project ||
      entry.serviceName ||
      processLabel(entry.process);

    entry.label = (mine && mine.label) || entry.title || entry.project || fallback || null;

    entry.web = !!(mine && mine.url) || entry.web || (entry.title !== null) || !!entry.framework;
    entry.url = (mine && mine.url) || (entry.web ? `${schemeFor(entry.port)}://localhost:${entry.port}/` : null);

    // Only a port that is down can be started again.
    entry.canLaunch = entry.state === 'stopped' && !!remembered[launcherKeyOf(entry.port, entry.protocol)];

    if (mine && mine.section) {
      entry.section = mine.section;
    } else if (mine && mine.label) {
      entry.section = 'apps';
    } else if (entry.project) {
      // A local project gets its own section, like a named app.
      entry.section = 'apps';
    } else if (entry.serviceName && entry.section === 'other') {
      // A port owned by a named Windows service belongs with the system ones.
      entry.section = 'system';
    } else if (entry.web && entry.section === 'other') {
      entry.section = 'web';
    }
  }

  // Named ports stay listed even when nothing is running on them, so you can
  // see that one of your apps is down.
  const open = new Set(state.open.map((e) => launcherKeyOf(e.port, e.protocol)));
  const present = new Set(state.open.map((e) => e.port));
  for (const [port, mine] of Object.entries(custom)) {
    const key = launcherKeyOf(port, 'tcp');
    if (present.has(Number(port))) continue;
    if (!mine.label && !mine.url) continue;

    state.open.push({
      port: Number(port),
      protocol: 'tcp',
      service: serviceFor(Number(port)),
      label: mine.label || null,
      custom: !!mine.label,
      title: null,
      project: null,
      projectPath: null,
      framework: null,
      section: mine.section || 'apps',
      url: mine.url || null,
      web: !!mine.url,
      addresses: [],
      pid: null,
      process: null,
      listenAddress: null,
      state: 'stopped',
      placeholder: true,
      canLaunch: !!remembered[key],
    });
    open.add(key);
    present.add(Number(port));
  }

  // Apps that have been seen before stay listed with a Start button, so a
  // dev server you closed can be brought back without leaving the page.
  if (state.local) {
    for (const [key, launcher] of Object.entries(remembered)) {
      if (open.has(key) || present.has(launcher.port)) continue;
      if (launcher.protocol !== state.protocol) continue;
      if (launcher.port === PORT) continue;

      state.open.push({
        port: launcher.port,
        protocol: launcher.protocol,
        service: serviceFor(launcher.port),
        label: launcher.label || labelFor(launcher.port) || processLabel(launcher.process) || null,
        custom: false,
        title: null,
        project: null,
        projectPath: launcher.cwd || null,
        framework: null,
        section: 'apps',
        url: null,
        web: false,
        addresses: [],
        pid: null,
        process: launcher.process || null,
        listenAddress: null,
        state: 'stopped',
        placeholder: true,
        canLaunch: true,
      });
      open.add(key);
      present.add(launcher.port);
    }
  }
}

/**
 * How many ports are actually open (named-but-stopped ports do not count).
 */
function openCount() {
  return state.open.filter((e) => e.state !== 'stopped').length;
}

/**
 * Ask every open port whether it speaks HTTP and read its page title.
 */
async function detectWebTitles() {
  const targets = state.open.filter((e) => e.protocol === 'tcp' && !e.custom);
  if (!targets.length) return 0;

  const results = await Promise.all(
    targets.map(async (entry) => {
      const host = (entry.addresses || [])[0] || 'localhost';
      const info = await detectWeb(entry.port, host, 900);
      return { entry, info };
    })
  );

  let found = 0;
  for (const { entry, info } of results) {
    if (!info) continue;
    if (info.title) {
      entry.title = info.title;
      found++;
    }
    if (info.isHtml || info.title) {
      entry.web = true;
      if (!entry.url) entry.url = `${info.scheme}://localhost:${entry.port}/`;
    }
    if (info.redirect && !entry.url) {
      entry.url = `${info.scheme}://localhost:${entry.port}/`;
    }

    // The server header often names the framework outright.
    const framework = frameworkLabel(info.poweredBy) || frameworkLabel(info.server);
    if (framework) {
      entry.framework = framework;
      found++;
    }
  }
  return found;
}

/**
 * Load the socket table plus process names.
 *
 * The PowerShell lookup already resolves process names, so tasklist is only
 * consulted when some names are still missing.
 */
async function resolveSockets() {
  const sockets = await listSockets();
  const missing = sockets.filter((s) => s.pid > 0 && !s.name).map((s) => s.pid);
  const names = missing.length ? await mapProcessNames(missing) : new Map();
  return { sockets, names };
}

/**
 * Work out what the app behind a port is called, from the command line of
 * the process that owns it. This is how a local project gets its own name
 * without anyone having to type it in.
 */
async function detectProjectNames(commands) {
  const map = commands || await mapProcessCommands();
  if (!map.size) return new Map();

  const projects = new Map();
  for (const entry of state.open) {
    if (!entry.pid || projects.has(entry.port)) continue;
    const project = detectProject(map.get(entry.pid));
    if (project) {
      projects.set(entry.port, project);
      entry.project = project.name;
      entry.projectPath = project.path;
    }
  }
  return projects;
}

/**
 * Remember how every listening app was started, so it can be started again
 * after it has been closed.
 *
 * Only processes a person could plausibly have launched are kept: the kernel,
 * service hosts and shell plumbing are skipped, and the command is unwrapped
 * from `cmd.exe /c` so the useful part is what gets stored.
 */
function captureLaunchers(commands) {
  if (!commands || !commands.size) return 0;

  const custom = portNames.all();
  let captured = 0;

  for (const entry of state.open) {
    if (entry.placeholder || entry.state !== 'listening') continue;
    // PortView cannot restart itself: the running instance owns that port.
    if (entry.port === PORT) continue;
    if (!entry.pid) continue;

    const raw = commands.get(entry.pid);
    if (!raw) continue;

    const command = normalizeCommand(unwrapShell(raw));
    const { exe } = parseCommandLine(command);
    if (!exe) continue;
    if (isSystemImage(exe) || isSystemImage(entry.process)) continue;

    const cwd = entry.projectPath || inferCwd(command);
    if (!cwd) continue;

    const named = custom[String(entry.port)];
    const saved = launchers.remember({
      port: entry.port,
      protocol: entry.protocol,
      command,
      cwd,
      label: (named && named.label) || entry.label || null,
      process: entry.process,
    });

    if (saved) captured++;
  }

  return captured;
}

/* ------------------------------------------------------------------ *
 * Starting a closed port
 * ------------------------------------------------------------------ */

/**
 * Start a process that outlives this request.
 *
 * On Windows the original command line is handed to the shell, because apps
 * are often started as `cmd.exe /c npm run dev` and re-splitting that by hand
 * breaks quoting that already worked once.
 */
function spawnDetached(command, exePath, args, cwd) {
  const options = {
    cwd: cwd || undefined,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  };

  if (process.platform === 'win32') {
    return spawn(command, { ...options, shell: true });
  }

  return spawn(exePath, args, options);
}

/**
 * Reject launches that did not come from the viewer itself.
 *
 * A launch runs an arbitrary command, so a page on another origin must not be
 * able to trigger one. Browsers already preflight a JSON POST; this closes the
 * gap for anything that does not.
 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;

  try {
    return new URL(origin).host === String(req.headers.host || '');
  } catch (_) {
    return false;
  }
}

function launchPort(body = {}) {
  const port = Number(body.port);
  const protocol = body.protocol === 'udp' ? 'udp' : 'tcp';

  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return { ok: false, reason: 'A valid port number is required.' };
  }

  const key = launcherKeyOf(port, protocol);
  const entry = state.open.find((e) => launcherKeyOf(e.port, e.protocol) === key);
  if (entry && entry.state !== 'stopped') {
    return { ok: false, reason: `Port ${port} is already open.` };
  }

  const inFlight = launches.get(key);
  if (inFlight && Date.now() - inFlight.at < 20000) {
    return { ok: false, reason: `Port ${port} was started a moment ago. Give it a few seconds.` };
  }

  const saved = launchers.get(port, protocol);
  const command = normalizeCommand(
    body.command !== undefined ? body.command : (saved && saved.command) || ''
  );

  if (!command) return { ok: false, reason: 'There is no saved command for that port.' };
  if (command.length > 2000) return { ok: false, reason: 'That command is too long.' };
  if (/[\r\n]/.test(command)) return { ok: false, reason: 'A command cannot contain a line break.' };

  const { exe, args } = parseCommandLine(command);
  if (!exe) return { ok: false, reason: 'Could not work out which program to run.' };

  if (isSystemImage(exe)) {
    return {
      ok: false,
      reason: `${path.basename(exe)} is an operating system process and cannot be started from here.`,
    };
  }

  const exePath = findExecutable(exe);
  if (!exePath) return { ok: false, reason: `Could not find "${exe}" on this machine.` };

  const rawCwd = body.cwd !== undefined ? String(body.cwd || '') : (saved && saved.cwd) || '';
  const cwd = rawCwd.trim() || null;
  if (cwd && !isDirectory(cwd)) {
    return { ok: false, reason: `The working directory "${cwd}" does not exist.` };
  }

  let child;
  try {
    child = spawnDetached(command, exePath, args, cwd);
  } catch (err) {
    return { ok: false, reason: `Could not start it: ${err.message}` };
  }

  child.on('error', (err) => {
    log(`Could not start port ${port}: ${err.message}`, 'error');
  });
  child.unref();

  launches.set(key, { pid: child.pid || null, at: Date.now(), command });

  const name = (saved && saved.label) || (entry && entry.label) || `port ${port}`;
  log(`Starting "${name}" on port ${port}: ${command}`);

  if (looksSensitive(command)) {
    log('That command may contain a credential. It is kept only in launchers.json.', 'warn');
  }

  // Look for the port shortly after, so the row updates without pressing Scan.
  setTimeout(() => {
    if (state.status === 'scanning') return;
    const options = { ...(state.lastOptions || {}) };
    if (!options.target) options.target = state.target;
    options.deep = false;
    startScan(options);
  }, 1500);

  return { ok: true, port, protocol, pid: child.pid || null, command, cwd };
}

function processNameOf(sock, names) {
  if (!sock || !sock.pid) return null;
  if (sock.name) return sock.name;
  return names.get(sock.pid) || null;
}

/**
 * Fill in PID / process / address for every known port.
 */
async function applyProcessInfo() {
  const { sockets, names } = await resolveSockets();

  for (const entry of state.open) {
    const chosen = pickSocket(sockets, entry.port, entry.protocol);
    if (!chosen) continue;
    entry.pid = chosen.pid || null;
    entry.process = processNameOf(chosen, names);
    entry.listenAddress = chosen.address;
    if (chosen.service) entry.serviceName = chosen.service;
    if (chosen.bound || chosen.state === 'LISTENING') entry.state = 'listening';
  }

  return { sockets: sockets.length, named: names.size };
}

/* ------------------------------------------------------------------ *
 * Scanning
 * ------------------------------------------------------------------ */

/**
 * Phase 1: ask the OS which ports it has bound, then probe just those.
 *
 * The full sweep takes tens of seconds; this returns the confirmed answer in
 * about a second. Probing matters because Windows happily accepts a
 * connection on ports that are merely reserved by a closing socket.
 */
async function fastPath(protocol, portSet) {
  const { sockets, names } = await resolveSockets();
  const wanted = new Set(buildPortList(portSet, state.startPort, state.endPort));
  const candidates = candidatePorts(sockets, protocol);
  const ports = [...candidates.keys()].filter((p) => wanted.has(p)).sort((a, b) => a - b);

  // TCP needs a probe: Windows accepts connections on ports that are merely
  // reserved by a closing socket, so the OS table alone over-reports.
  // UDP does not - a bound UDP socket is open by definition.
  let results = [];
  if (protocol === 'tcp') {
    const probes = [];
    for (const port of ports) {
      const addrs = new Set(['127.0.0.1', '::1']);
      for (const sock of candidates.get(port)) {
        const a = String(sock.address || '').toLowerCase();
        if (a === '0.0.0.0' || a === '*' || a === '::') continue;
        addrs.add(sock.address);
      }
      for (const addr of addrs) {
        probes.push(checkTcp(addr, port, 500).then((res) => ({ ...res, port })));
      }
    }
    results = await Promise.all(probes);
  } else {
    results = ports.map((port) => ({ port, host: '127.0.0.1', open: true }));
  }

  let count = 0;
  const seen = new Set();
  for (const res of results) {
    if (!res.open) continue;
    if (seen.has(res.port)) continue;
    seen.add(res.port);

    const entry = upsertPort(res.port, res.host, protocol, 'listening');
    const chosen = pickSocket(sockets, res.port, protocol);
    if (chosen) {
      entry.pid = chosen.pid || null;
      entry.process = processNameOf(chosen, names);
      entry.listenAddress = chosen.address;
      if (chosen.service) entry.serviceName = chosen.service;
      if (!entry.addresses.includes(chosen.address)) entry.addresses.push(chosen.address);
    }
    count++;
  }

  if (count) {
    log(`OS socket table: ${count} confirmed ${protocol.toUpperCase()} port${count === 1 ? '' : 's'} (of ${ports.length} candidate${ports.length === 1 ? '' : 's'}).`);
  } else {
    log(`OS socket table: no ${protocol.toUpperCase()} ports in the selected range.`);
  }

  decorateEntries();
  broadcast('state', snapshot());

  return { count, confirmed: seen };
}

async function runScan(options) {
  const hosts = state.hosts;
  const protocol = state.protocol;
  const isLocal = hosts.every((h) => isLocalHost(h));

  // Phase 1 - authoritative OS socket table (local targets only).
  let confirmed = null;
  if (isLocal) {
    const t0 = Date.now();
    try {
      const res = await fastPath(protocol, state.portSet);
      confirmed = res.confirmed;
      log(`Listener table resolved in ${Date.now() - t0}ms.`);
    } catch (err) {
      log(`Listener table unavailable: ${err.message}`, 'warn');
    }
  }

  // Phase 2 - probe sweep, confirms reachability and covers remote targets.
  // Remote targets can only be probed, so the sweep is mandatory there.
  const deep = options.deep === false && isLocal ? false : true;
  if (!deep) {
    log('Deep probe disabled — showing OS listener table only.');
    state.total = state.open.length;
    state.scanned = state.total;
    return;
  }

  const isLoopback = hosts.every((h) => h === '127.0.0.1' || h === '::1');
  // Windows' loopback stack starts dropping SYNs once too many sockets are in
  // flight, so a small pool is measurably faster than a wide one here.
  // UDP needs a wide pool and a short wait: an unanswered probe tells us
  // nothing, so there is no point lingering on it.
  const defaults = protocol === 'udp'
    ? { concurrency: isLoopback ? 1000 : 500, timeout: isLoopback ? 200 : 700 }
    : { concurrency: isLoopback ? 64 : Math.max(200, Math.min(3000, hosts.length * 40)), timeout: isLoopback ? 400 : 900 };

  const concurrency = options.concurrency
    ? Math.max(1, Math.min(5000, Number(options.concurrency)))
    : defaults.concurrency;
  const timeout = options.timeout
    ? Math.max(50, Math.min(5000, Number(options.timeout)))
    : defaults.timeout;

  let lastPush = 0;
  const pushState = (force) => {
    const now = Date.now();
    if (!force && now - lastPush < 400) return;
    lastPush = now;
    broadcast('state', snapshot());
  };

  let probeOnly = 0;

  await scan(hosts, buildPortList(state.portSet, state.startPort, state.endPort), {
    concurrency,
    timeout,
    protocol,
    isCancelled: () => cancelFlag,
    onOpen: (res) => {
      // For local targets the OS table is the source of truth. A probe that
      // succeeds on a port the kernel does not list is a Windows artefact
      // (a closing socket still holds its port), so it is not reported.
      if (isLocal && confirmed && !confirmed.has(res.port)) {
        probeOnly++;
        return;
      }
      const entry = upsertPort(res.port, res.host, protocol, 'open');
      decorateEntries();
      broadcast('port', entry);
    },
    onProgress: ({ scanned, total }) => {
      state.scanned = scanned;
      state.total = total;
      broadcast('progress', { scanned, total });
      pushState(false);
    },
  });

  if (probeOnly) {
    log(`Ignored ${probeOnly} probe-only port${probeOnly === 1 ? '' : 's'} (not held by any OS socket).`);
  }
}

/**
 * Kick off a scan. Returns immediately; results stream over SSE.
 */
function startScan(options = {}) {
  if (state.status === 'scanning') return { ok: false, reason: 'A scan is already running.' };

  const target = options.target !== undefined ? String(options.target) : state.target;
  const protocol = options.protocol === 'udp' ? 'udp' : 'tcp';
  const portSet = options.portSet || 'all';
  const startPort = options.startPort !== undefined ? Number(options.startPort) : 1;
  const endPort = options.endPort !== undefined ? Number(options.endPort) : 65535;

  const hosts = resolveHosts(target);

  cancelFlag = false;
  state.runId += 1;
  state.status = 'scanning';
  state.target = target;
  state.hosts = hosts;
  state.protocol = protocol;
  state.portSet = portSet;
  state.startPort = startPort;
  state.endPort = endPort;
  state.total = 0;
  state.scanned = 0;
  state.open = [];
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.durationMs = null;
  state.error = null;
  state.local = hosts.every((h) => isLocalHost(h));
  state.deep = options.deep !== false;

  log(`Scan started: ${protocol.toUpperCase()} ${target} — ${hosts.join(', ')} (run #${state.runId})`);
  broadcast('state', snapshot());

  const opts = { ...options };
  state.lastOptions = {
    target,
    protocol,
    portSet,
    startPort,
    endPort,
    deep: options.deep !== false,
  };

  (async () => {
    try {
      await runScan(opts);

      state.finishedAt = Date.now();
      state.durationMs = state.finishedAt - state.startedAt;

      if (cancelFlag) {
        state.status = 'cancelled';
        log(`Scan cancelled after ${state.scanned} probes.`, 'warn');
      } else {
        state.status = 'complete';
        const listening = state.open.filter((e) => e.state === 'listening').length;
        const probed = state.open.filter((e) => e.state === 'open').length;
        log(
          `Scan complete in ${(state.durationMs / 1000).toFixed(2)}s — ` +
          `${openCount()} open port${openCount() === 1 ? '' : 's'} ` +
          `(${listening} listening, ${probed} probe-only).`
        );
      }

      try {
        const info = await applyProcessInfo();
        log(`Resolved ${info.sockets} socket${info.sockets === 1 ? '' : 's'} / ${info.named} process name${info.named === 1 ? '' : 's'}.`);
      } catch (err) {
        log(`Process lookup failed: ${err.message}`, 'warn');
      }

      try {
        const titled = await detectWebTitles();
        if (titled) log(`Read ${titled} page title${titled === 1 ? '' : 's'} from open web ports.`);
      } catch (err) {
        log(`Page title detection failed: ${err.message}`, 'warn');
      }

      let commands = null;
      try {
        commands = await mapProcessCommands();
        const projects = await detectProjectNames(commands);
        if (projects.size) {
          const named = [...projects.values()].map((p) => p.name);
          log(`Identified ${named.length} local project${named.length === 1 ? '' : 's'}: ${[...new Set(named)].join(', ')}.`);
        }
      } catch (err) {
        log(`Project detection failed: ${err.message}`, 'warn');
      }

      try {
        const remembered = captureLaunchers(commands);
        if (remembered) {
          log(`Remembered how ${remembered} app${remembered === 1 ? ' is' : 's are'} started, so you can restart ${remembered === 1 ? 'it' : 'them'} from here.`);
        }
      } catch (err) {
        log(`Could not remember start commands: ${err.message}`, 'warn');
      }

      decorateEntries();
    } catch (err) {
      state.status = 'error';
      state.error = err.message;
      state.finishedAt = Date.now();
      state.durationMs = state.finishedAt - state.startedAt;
      log(`Scan failed: ${err.message}`, 'error');
    }

    broadcast('state', snapshot());
    broadcast('done', snapshot());
  })();

  return { ok: true };
}

function stopScan() {
  if (state.status !== 'scanning') return { ok: false, reason: 'No scan is running.' };
  cancelFlag = true;
  log('Cancellation requested...', 'warn');
  return { ok: true };
}

function setWatch(intervalMs) {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
  if (intervalMs && intervalMs > 0) {
    watchTimer = setInterval(() => {
      if (state.status !== 'scanning') startScan(state.lastOptions || {});
    }, intervalMs);
    log(`Watch mode enabled — rescanning every ${Math.round(intervalMs / 1000)}s.`);
  } else {
    log('Watch mode disabled.');
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);

  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) {
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function toCsv(entries) {
  const head = ['port', 'name', 'section', 'protocol', 'service', 'state', 'pid', 'process', 'listen_address', 'url', 'addresses'];
  const rows = entries.map((e) => [
    e.port,
    e.label || '',
    e.section || '',
    e.protocol,
    e.service || '',
    e.state,
    e.pid || '',
    e.process || '',
    e.listenAddress || '',
    e.url || '',
    (e.addresses || []).join(' '),
  ]);
  const esc = (v) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    res.write(`event: log\ndata: ${JSON.stringify({ t: Date.now(), level: 'info', line: 'Connected to PortView.' })}\n\n`);
    // Replay recent activity so the panel is not empty when connecting late.
    for (const entry of recentLogs) {
      res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
    }
    clients.add(res);

    const keepAlive = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) { clearInterval(keepAlive); }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      clients.delete(res);
    });
    return;
  }

  if (pathname === '/api/state') {
    return sendJson(res, 200, snapshot());
  }

  if (pathname === '/api/scan' && req.method === 'POST') {
    const body = await readBody(req);
    log(`API scan request: ${JSON.stringify(body)}`);
    return sendJson(res, 200, startScan(body));
  }

  if (pathname === '/api/stop' && req.method === 'POST') {
    log('API stop request');
    return sendJson(res, 200, stopScan());
  }

  if (pathname === '/api/watch' && req.method === 'POST') {
    const body = await readBody(req);
    log(`API watch request: ${JSON.stringify(body)}`);
    return sendJson(res, 200, setWatch(Number(body.intervalMs) || 0));
  }

  if (pathname === '/api/processes' && req.method === 'POST') {
    log('API process refresh request');
    await applyProcessInfo();
    decorateEntries();
    broadcast('state', snapshot());
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/names' && req.method === 'GET') {
    return sendJson(res, 200, portNames.all());
  }

  if (pathname === '/api/names' && req.method === 'POST') {
    const body = await readBody(req);
    const port = Number(body.port);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      return sendJson(res, 400, { error: 'A valid port number is required.' });
    }

    const saved = portNames.set(port, {
      label: body.label === undefined ? undefined : body.label,
      url: body.url === undefined ? undefined : body.url,
      section: body.section === undefined ? undefined : body.section,
    });

    if (saved && saved.label) {
      log(`Named port ${port} "${saved.label}".`);
    } else {
      log(`Cleared the name for port ${port}.`);
    }

    decorateEntries();
    broadcast('state', snapshot());
    return sendJson(res, 200, { ok: true, port, entry: saved, names: portNames.all() });
  }

  if (pathname === '/api/names' && req.method === 'DELETE') {
    const body = await readBody(req);
    const port = Number(body.port);
    if (!Number.isFinite(port)) return sendJson(res, 400, { error: 'A valid port number is required.' });
    portNames.remove(port);
    log(`Cleared the name for port ${port}.`);
    decorateEntries();
    broadcast('state', snapshot());
    return sendJson(res, 200, { ok: true, names: portNames.all() });
  }

  if (pathname === '/api/launchers' && req.method === 'GET') {
    const port = Number(url.searchParams.get('port'));
    const protocol = url.searchParams.get('protocol') === 'udp' ? 'udp' : 'tcp';

    if (Number.isFinite(port) && port > 0) {
      const one = launchers.get(port, protocol);
      if (!one) return sendJson(res, 404, { error: 'No saved command for that port.' });
      return sendJson(res, 200, { ...one, sensitive: looksSensitive(one.command) });
    }

    return sendJson(res, 200, launchers.all());
  }

  if (pathname === '/api/launch' && req.method === 'POST') {
    if (!sameOrigin(req)) {
      return sendJson(res, 403, { error: 'Cross-origin launch requests are not allowed.' });
    }

    const body = await readBody(req);
    const result = launchPort(body);
    if (!result.ok) log(`Launch refused: ${result.reason}`, 'warn');
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  if (pathname === '/api/launchers' && req.method === 'DELETE') {
    const body = await readBody(req);
    const port = Number(body.port);
    if (!Number.isFinite(port)) {
      return sendJson(res, 400, { error: 'A valid port number is required.' });
    }
    launchers.forget(port, body.protocol);
    log(`Forgot the start command for port ${port}.`);
    decorateEntries();
    broadcast('state', snapshot());
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/export') {
    const format = url.searchParams.get('format') || 'json';
    if (format === 'csv') {
      const csv = toCsv(snapshot().open);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="open-ports.csv"',
      });
      return res.end(csv);
    }
    const body = JSON.stringify(snapshot(), null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="open-ports.json"',
    });
    return res.end(body);
  }

  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { error: 'Unknown endpoint' });
  }

  serveStatic(req, res, pathname);
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, HOST, () => {
  console.log(`\n  PortView running at http://${HOST}:${PORT}\n`);
});

process.on('uncaughtException', (err) => {
  // A single bad probe must never take the viewer down.
  console.error(`[ERR ] Uncaught exception: ${err && err.message}`);
  log(`Uncaught exception: ${err && err.message}`, 'error');
});

process.on('unhandledRejection', (err) => {
  console.error(`[ERR ] Unhandled rejection: ${err && err.message}`);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
});
