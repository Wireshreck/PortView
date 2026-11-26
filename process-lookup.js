'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WINDOWS = process.platform === 'win32';

/**
 * Run a command and resolve with stdout (empty string on failure).
 */
function run(cmd, args, timeout = 20000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
        if (err && !stdout) return resolve('');
        resolve(stdout || '');
      });
    } catch (_) {
      resolve('');
    }
  });
}

/* ------------------------------------------------------------------ *
 * Windows
 * ------------------------------------------------------------------ */

/**
 * Parse `netstat -ano`. Fast (~50ms) but the OS drops some LISTENING rows
 * once the connection table grows, so this is merged with the PowerShell
 * lookup rather than used on its own.
 */
function parseNetstat(out) {
  const results = [];
  if (!out) return results;

  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    const proto = (parts[0] || '').toUpperCase();
    if (proto !== 'TCP' && proto !== 'UDP') continue;

    const local = splitHostPort(parts[1]);
    if (!local) continue;

    const pid = Number(parts[parts.length - 1]);
    if (!Number.isFinite(pid) || pid < 0) continue;

    let remotePort = 0;
    let state = '';
    if (proto === 'TCP') {
      state = (parts[3] || '').toUpperCase();
      const remote = splitHostPort(parts[2]);
      remotePort = remote ? remote.port : 0;
    } else {
      const remote = splitHostPort(parts[2]);
      remotePort = remote ? remote.port : 0;
    }

    results.push({
      address: local.host,
      port: local.port,
      pid,
      proto: proto.toLowerCase(),
      remotePort,
      state,
      bound: remotePort === 0,
    });
  }

  return results;
}

/**
 * Complete socket table via the PowerShell IP Helper cmdlets.
 *
 * `Get-NetTCPConnection -State Listen` is unreliable on some Windows builds
 * (newer kernels report state values the module cannot map, so real listeners
 * come back blank), so every row is fetched and classified locally instead.
 *
 * The process table is read in the same invocation. One PowerShell start-up
 * costs about a second, and the command line is needed for project names and
 * launch commands anyway, so paying for a second call made every scan slower
 * for no extra information.
 */
async function listSocketsPowerShell() {
  const cmd = [
    "$ErrorActionPreference='SilentlyContinue';",
    "$p = @{};",
    "$procs = @(Get-CimInstance Win32_Process | ForEach-Object { $p[[int]$_.ProcessId] = $_; [PSCustomObject]@{ ProcessId=$_.ProcessId; Name=$_.Name; CommandLine=$_.CommandLine } });",
    // Windows services know their own display name, which beats "svchost.exe".
    "$s = @{};",
    "Get-CimInstance Win32_Service | ForEach-Object { if ($_.ProcessId -gt 0) { $s[[int]$_.ProcessId] = $_.DisplayName } };",
    "$tcp = @(Get-NetTCPConnection | ForEach-Object { $k = [int]$_.OwningProcess; $proc = $p[$k];",
    "  [PSCustomObject]@{ LocalAddress=$_.LocalAddress; LocalPort=$_.LocalPort; RemotePort=$_.RemotePort; OwningProcess=$k; Proto='tcp'; Name=$proc.Name; Service=$s[$k] }",
    "});",
    "$udp = @(Get-NetUDPEndpoint | ForEach-Object { $k = [int]$_.OwningProcess; $proc = $p[$k];",
    "  [PSCustomObject]@{ LocalAddress=$_.LocalAddress; LocalPort=$_.LocalPort; RemotePort=0; OwningProcess=$k; Proto='udp'; Name=$proc.Name; Service=$s[$k] }",
    "});",
    // Command lines are sent once per process, not once per socket: a busy
    // machine has many sockets per process and the repeated text made the
    // payload an order of magnitude larger than it needed to be.
    "[PSCustomObject]@{ sockets = @($tcp) + @($udp); processes = $procs } | ConvertTo-Json -Compress -Depth 4",
  ].join(' ');

  const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], 25000);
  if (!out.trim()) return { sockets: [], commands: new Map() };

  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch (_) {
    return { sockets: [], commands: new Map() };
  }

  const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);
  const socketRows = asArray(parsed && parsed.sockets);
  const processRows = asArray(parsed && parsed.processes);

  const commands = new Map();
  for (const proc of processRows) {
    const pid = Number(proc.ProcessId);
    if (Number.isFinite(pid) && pid > 0 && proc.CommandLine) {
      commands.set(pid, String(proc.CommandLine));
    }
  }

  const results = [];
  for (const row of socketRows) {
    const port = Number(row.LocalPort);
    const pid = Number(row.OwningProcess);
    if (!Number.isFinite(port) || port < 1) continue;
    if (!Number.isFinite(pid) || pid < 0) continue;

    const remotePort = Number(row.RemotePort) || 0;
    results.push({
      address: String(row.LocalAddress || '0.0.0.0'),
      port,
      pid,
      proto: row.Proto === 'udp' ? 'udp' : 'tcp',
      remotePort,
      state: '',
      bound: remotePort === 0,
      name: row.Name || null,
      service: row.Service || null,
    });
  }

  return { sockets: results, commands };
}

/* ------------------------------------------------------------------ *
 * Unix
 * ------------------------------------------------------------------ */

async function listSocketsUnix() {
  const out = await run('ss', ['-tulnpH']);
  const results = [];

  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    if (!m) continue;
    const fields = line.trim().split(/\s+/);
    const local = splitHostPort(fields[3]);
    if (!local) continue;
    const remote = splitHostPort(fields[4]);
    results.push({
      address: local.host,
      port: local.port,
      pid: Number(m[2]),
      proto: fields[0].toLowerCase().startsWith('udp') ? 'udp' : 'tcp',
      remotePort: remote ? remote.port : 0,
      state: (fields[5] || '').toUpperCase(),
      bound: !remote || remote.port === 0,
    });
  }
  return results;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * All sockets the OS knows about, plus the command line of each owner.
 * Each socket row: { address, port, pid, proto, remotePort, state, bound }
 */
async function listSocketTable() {
  if (!IS_WINDOWS) {
    const sockets = await listSocketsUnix();
    return { sockets, commands: commandsFromSockets(sockets) };
  }

  const [netstatRows, ps] = await Promise.all([
    run('netstat', ['-ano']).then(parseNetstat),
    listSocketsPowerShell(),
  ]);

  if (ps.sockets.length) return ps;
  return { sockets: netstatRows, commands: new Map() };
}

/**
 * Just the socket rows, for callers that do not need command lines.
 */
async function listSockets() {
  const { sockets } = await listSocketTable();
  return sockets;
}

/**
 * Command lines that socket rows carry themselves.
 *
 * Windows keeps them in a separate process list, so this only collects rows
 * from sources that include one, such as a future Unix table. Rows without a
 * command line are skipped.
 */
function commandsFromSockets(sockets) {
  const commands = new Map();
  for (const socket of sockets || []) {
    const pid = Number(socket.pid);
    if (Number.isFinite(pid) && pid > 0 && socket.command) {
      commands.set(pid, String(socket.command));
    }
  }
  return commands;
}

/**
 * Ports that the OS reports as bound (accepting connections).
 */
function candidatePorts(sockets, protocol) {
  const map = new Map();
  for (const s of sockets) {
    if (protocol && s.proto !== protocol) continue;
    if (!s.bound && s.state !== 'LISTENING') continue;
    if (!map.has(s.port)) map.set(s.port, []);
    map.get(s.port).push(s);
  }
  return map;
}

/**
 * Choose the socket row that best represents who owns a port.
 *
 * The most frequent non-zero PID wins: lingering TIME_WAIT sockets are owned
 * by pid 0 and would otherwise mask the real process.
 */
function pickSocket(sockets, port, protocol) {
  const rows = sockets.filter((s) => s.port === port && (!protocol || s.proto === protocol));
  if (!rows.length) return null;

  const tally = new Map();
  for (const r of rows) {
    if (r.pid > 0) tally.set(r.pid, (tally.get(r.pid) || 0) + 1);
  }

  let best = null;
  if (tally.size) {
    let bestCount = -1;
    for (const [pid, count] of tally) {
      if (count > bestCount) {
        bestCount = count;
        best = rows.find((r) => r.pid === pid && r.bound) || rows.find((r) => r.pid === pid);
      }
    }
    return best;
  }

  // Only pid 0 rows: prefer a bound socket, then anything.
  return rows.find((r) => r.bound) || rows[0];
}

/**
 * Map of pid -> process image name.
 */
async function mapProcessNames(pids) {
  const wanted = new Set((pids || []).filter((p) => Number.isFinite(p) && p > 0));
  const names = new Map();
  if (!wanted.size) return names;

  if (IS_WINDOWS) {
    const out = await run('tasklist', ['/fo', 'csv', '/nh']);
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^"([^"]*)","(\d+)"/);
      if (!m) continue;
      const pid = Number(m[2]);
      if (wanted.has(pid)) names.set(pid, m[1]);
    }
  } else {
    const out = await run('ps', ['-eo', 'pid=,comm=']);
    for (const line of out.split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      if (wanted.has(pid)) names.set(pid, m[2]);
    }
  }

  return names;
}

/* ------------------------------------------------------------------ *
 * Project detection
 * ------------------------------------------------------------------ */

/**
 * Command line of every running process, keyed by pid.
 */
async function mapProcessCommands() {
  const commands = new Map();

  if (!IS_WINDOWS) {
    const out = await run('ps', ['-eo', 'pid=,args=']);
    for (const line of out.split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (m) commands.set(Number(m[1]), m[2]);
    }
    return commands;
  }

  const cmd =
    "$ErrorActionPreference='SilentlyContinue';" +
    "Get-CimInstance Win32_Process | ForEach-Object { " +
    "[PSCustomObject]@{ ProcessId=$_.ProcessId; CommandLine=$_.CommandLine } } | ConvertTo-Json -Compress";

  const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], 20000);
  if (!out.trim()) return commands;

  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch (_) {
    return commands;
  }
  if (!Array.isArray(parsed)) parsed = [parsed];

  for (const row of parsed) {
    const pid = Number(row.ProcessId);
    if (Number.isFinite(pid) && row.CommandLine) commands.set(pid, String(row.CommandLine));
  }
  return commands;
}

const SCRIPT_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|vue|svelte|py|rb|php|jar|ps1)$/i;

/**
 * The package directory inside a "node_modules/<pkg>" path.
 */
function packageDirFromPath(p) {
  const parts = String(p).split(/[\\/]/);
  const i = parts.lastIndexOf('node_modules');
  if (i < 0 || i + 1 >= parts.length) return null;
  return parts.slice(0, i + 2).join(path.sep);
}

/**
 * The name from a package.json, if it has one.
 */
function readPackageName(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const name = pkg.productName || pkg.name;
    if (name) {
      return {
        name: String(name).replace(/[-_]+/g, ' '),
        path: dir,
        source: 'package.json',
      };
    }
  } catch (_) { /* no readable package.json */ }
  return null;
}

/**
 * Work out what a process is, from its command line.
 *
 * Three shapes are handled:
 *   - a globally installed npm package   -> the package's own name
 *   - "python -m some.module"           -> the module name
 *   - an absolute script path            -> the project directory it lives in
 *
 * Only absolute paths are considered for the last case: a relative one would
 * be resolved against this process's working directory, which is almost never
 * the directory the target was started from.
 */
function detectProject(commandLine) {
  if (!commandLine) return null;

  const tokens = (commandLine.match(/"[^"]+"|\S+/g) || []).map((t) => t.replace(/^"|"$/g, ''));

  // A globally installed npm package.
  for (const token of tokens) {
    if (!/node_modules/i.test(token)) continue;
    const pkgDir = packageDirFromPath(token);
    if (!pkgDir) continue;
    const named = readPackageName(pkgDir);
    if (named) return named;
    const fallback = path.basename(pkgDir);
    if (fallback && fallback !== 'node_modules') {
      return { name: fallback.replace(/[-_]+/g, ' '), path: pkgDir, source: 'npm package' };
    }
  }

  // "python -m package.module [role]"
  const moduleFlag = tokens.findIndex((t) => t === '-m' || t === '--module');
  if (moduleFlag >= 0 && tokens[moduleFlag + 1]) {
    const module = tokens[moduleFlag + 1];
    const top = module.split('.').filter(Boolean)[0];
    if (top) {
      const base = top.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      // The first plain argument after the module is usually the role the
      // program is playing: "gateway", "server", "worker" and so on.
      const role = tokens.slice(moduleFlag + 2).find((t) => !t.startsWith('-') && /^[a-z][\w-]*$/i.test(t));
      return {
        name: role ? `${base} ${role.replace(/\b\w/g, (c) => c.toUpperCase())}` : base,
        path: null,
        source: 'module',
      };
    }
  }

  // An absolute script path.
  const paths = tokens.filter((t) => SCRIPT_EXT.test(t) && path.isAbsolute(t));
  let script = paths.find((t) => fs.existsSync(t)) || paths[0] || null;

  if (!script) {
    const exe = tokens.find((t) => /\.exe$/i.test(t) && path.isAbsolute(t));
    if (exe) script = exe;
  }

  if (!script) return null;

  let dir = path.dirname(script);

  // "C:\app\node_modules\vite\bin\vite.js" -> "C:\app"
  const parts = dir.split(/[\\/]/);
  const nodeModulesAt = parts.lastIndexOf('node_modules');
  if (nodeModulesAt > 0) {
    dir = parts.slice(0, nodeModulesAt).join(path.sep);
  }

  for (const candidate of [dir, path.dirname(dir)]) {
    const named = readPackageName(candidate);
    if (named) return named;
  }

  return null;
}

/**
 * Split "0.0.0.0:135" / "[::]:445" / "127.0.0.1:8080" into host + port.
 */
function splitHostPort(value) {
  if (!value) return null;
  const idx = value.lastIndexOf(':');
  if (idx < 0) return null;
  const port = Number(value.slice(idx + 1));
  if (!Number.isFinite(port)) return null;
  let host = value.slice(0, idx);
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return { host, port };
}

function describeHost() {
  return `${os.hostname()} (${os.platform()})`;
}

module.exports = {
  listSockets,
  listSocketTable,
  candidatePorts,
  pickSocket,
  mapProcessNames,
  mapProcessCommands,
  commandsFromSockets,
  detectProject,
  parseNetstat,
  describeHost,
  IS_WINDOWS,
};
