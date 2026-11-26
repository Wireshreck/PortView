'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, 'launchers.json');
const MAX_ENTRIES = 100;
const MAX_COMMAND = 2000;

/**
 * Processes that must never be started from the viewer. They are either the
 * kernel itself, a Windows service host, or a shell that only exists to serve
 * something else. Nothing here is a user application.
 */
const SYSTEM_IMAGES = new Set([
  'system',
  'idle',
  'registry',
  'smss.exe',
  'csrss.exe',
  'wininit.exe',
  'winlogon.exe',
  'services.exe',
  'lsass.exe',
  'svchost.exe',
  'spoolsv.exe',
  'dwm.exe',
  'fontdrvhost.exe',
  'conhost.exe',
  'sihost.exe',
  'taskhostw.exe',
  'explorer.exe',
  'lsm.exe',
  'userinit.exe',
  'logonui.exe',
  'sppsvc.exe',
  'wmiprvse.exe',
  'dllhost.exe',
  'audiodg.exe',
  'msmpeng.exe',
  'nissrv.exe',
  'securityhealthservice.exe',
  'searchindexer.exe',
  'searchhost.exe',
  'searchapp.exe',
  'runtimebroker.exe',
  'applicationframehost.exe',
  'textinputhost.exe',
  'startmenuexperiencehost.exe',
  'shellexperiencehost.exe',
  'ctfmon.exe',
  'wudfhost.exe',
]);

const SCRIPT_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|vue|svelte|py|rb|php|jar|ps1|cmd|bat)$/i;

/** Flags whose values are usually credentials. */
const SENSITIVE = /(password|passwd|secret|token|api[-_]?key|apikey|bearer|credential)/i;

const IS_WINDOWS = process.platform === 'win32';

function keyOf(port, protocol) {
  return `${Number(port)}/${protocol === 'udp' ? 'udp' : 'tcp'}`;
}

/**
 * Split a command line into tokens, honouring double and single quotes.
 */
function tokenize(raw) {
  const tokens = String(raw || '').match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return tokens.map((token) => {
    if (token.length >= 2) {
      const first = token[0];
      const last = token[token.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return token.slice(1, -1);
      }
    }
    return token;
  });
}

/**
 * The program and its arguments, from a raw command line.
 */
function parseCommandLine(raw) {
  const tokens = tokenize(raw);
  if (!tokens.length) return { exe: null, args: [], tokens: [] };
  return { exe: tokens[0], args: tokens.slice(1), tokens };
}

/**
 * Quote a token again when it needs it, so an unwrapped command stays valid.
 */
function quote(token) {
  return /[\s"]/.test(token) ? `"${token.replace(/"/g, '\\"')}"` : token;
}

/**
 * The last segment of a path, whichever separator it uses. A stored Windows
 * command line still has to be understood when the tests run on Linux.
 */
function imageName(value) {
  const parts = String(value || '').split(/[\\/]/);
  return (parts[parts.length - 1] || '').toLowerCase();
}

/**
 * Many servers are started through a shell, so the process table holds
 * `cmd.exe /d /s /c "vite"` rather than `vite`. The inner command is the
 * useful part: it is what a person would type again.
 */
function unwrapShell(raw) {
  const { exe, args } = parseCommandLine(raw);
  if (!exe) return String(raw || '').trim();

  const name = imageName(exe);

  if (name === 'cmd.exe' || name === 'cmd') {
    const at = args.findIndex((a) => /^\/[ck]$/i.test(a));
    if (at >= 0 && args[at + 1]) return args.slice(at + 1).join(' ');
  }

  if (name === 'powershell.exe' || name === 'powershell' || name === 'pwsh.exe' || name === 'pwsh') {
    const at = args.findIndex((a) => /^-(command|c)$/i.test(a));
    if (at >= 0 && args[at + 1]) {
      return args.slice(at + 1).map(quote).join(' ');
    }
  }

  return String(raw || '').trim();
}

/**
 * Collapse runs of spaces outside quotes. A shell sometimes inserts one, and
 * the stored command reads badly with `exe"  script` in it.
 */
function normalizeCommand(raw) {
  let out = '';
  let quote = null;
  let lastWasSpace = false;

  for (const ch of String(raw || '').trim()) {
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      lastWasSpace = false;
      continue;
    }

    if (ch === ' ' || ch === '\t') {
      if (!lastWasSpace) out += ' ';
      lastWasSpace = true;
      continue;
    }

    out += ch;
    lastWasSpace = false;
  }

  return out;
}

function isSystemImage(image) {
  if (!image) return true;
  return SYSTEM_IMAGES.has(imageName(image));
}

function looksSensitive(command) {
  return SENSITIVE.test(String(command || ''));
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (_) {
    return false;
  }
}

/**
 * Resolve a program name to a real file, using PATH the way a shell would.
 */
function findExecutable(exe, envPath = process.env.PATH || '') {
  if (!exe) return null;

  if (path.isAbsolute(exe)) {
    try {
      return fs.statSync(exe).isFile() ? exe : null;
    } catch (_) {
      return null;
    }
  }

  const extensions = IS_WINDOWS
    ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')]
    : [''];

  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = path.join(dir, exe + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch (_) { /* keep looking */ }
    }
  }

  return null;
}

/**
 * The directory an app most likely has to be started from.
 *
 * A package directory found earlier wins, then the folder of an absolute
 * script, then the folder of the executable. Relative paths are never used:
 * they would resolve against this process's directory instead.
 */
function inferCwd(command, projectPath) {
  if (projectPath && isDirectory(projectPath)) return projectPath;

  const { exe, args } = parseCommandLine(command);
  const tokens = [exe, ...args].filter(Boolean);

  const script = tokens.find((t) => path.isAbsolute(t) && SCRIPT_EXT.test(t));
  if (script && isDirectory(path.dirname(script))) return path.dirname(script);

  // A relative script means the app was started from that script's folder, and
  // Windows does not report a process's working directory. Guessing the
  // executable's folder would store a command that fails, so give up instead.
  const relativeScript = args.find((t) => !path.isAbsolute(t) && !t.startsWith('-') && SCRIPT_EXT.test(t));
  if (relativeScript) return null;

  if (exe && path.isAbsolute(exe) && isDirectory(path.dirname(exe))) return path.dirname(exe);

  return null;
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

/**
 * Store of the commands behind the ports that have been seen.
 *
 * Shape:
 *   { "4173/tcp": { port, protocol, command, cwd, label, process, capturedAt } }
 *
 * The file holds command lines, which can include paths and sometimes flags
 * you would rather keep to yourself. It lives next to the app and is listed in
 * .gitignore.
 */
function createStore(file = DEFAULT_FILE) {
  let cache = null;

  function read() {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      cache = {};
    }
    return cache;
  }

  function write(data) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
    cache = data;
    return data;
  }

  return {
    all() {
      return { ...read() };
    },

    get(port, protocol) {
      return read()[keyOf(port, protocol)] || null;
    },

    /**
     * Remember how a port was started. Repeated scans with the same command
     * do not touch the disk.
     */
    remember(record = {}) {
      const port = Number(record.port);
      if (!Number.isFinite(port) || port < 1 || port > 65535) return null;

      const protocol = record.protocol === 'udp' ? 'udp' : 'tcp';
      const command = String(record.command || '').trim().slice(0, MAX_COMMAND);
      if (!command || /[\r\n]/.test(command)) return null;

      const key = keyOf(port, protocol);
      const existing = read()[key];
      const cwd = record.cwd ? String(record.cwd) : null;
      const label = record.label ? String(record.label).slice(0, 120) : null;

      if (existing && existing.command === command && existing.cwd === cwd && existing.label === label) {
        return existing;
      }

      const data = { ...read() };
      data[key] = {
        port,
        protocol,
        command,
        cwd,
        label,
        process: record.process ? String(record.process).slice(0, 120) : null,
        capturedAt: Date.now(),
      };

      const keys = Object.keys(data);
      if (keys.length > MAX_ENTRIES) {
        keys
          .sort((a, b) => (data[a].capturedAt || 0) - (data[b].capturedAt || 0))
          .slice(0, keys.length - MAX_ENTRIES)
          .forEach((k) => delete data[k]);
      }

      write(data);
      return data[key];
    },

    forget(port, protocol) {
      const data = { ...read() };
      delete data[keyOf(port, protocol)];
      write(data);
    },

    file,
  };
}

module.exports = {
  createStore,
  DEFAULT_FILE,
  MAX_ENTRIES,
  SYSTEM_IMAGES,
  keyOf,
  imageName,
  tokenize,
  parseCommandLine,
  unwrapShell,
  normalizeCommand,
  isSystemImage,
  looksSensitive,
  inferCwd,
  isDirectory,
  findExecutable,
};
