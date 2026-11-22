'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const services = require('../services');
const scanner = require('../scanner');
const { parseNetstat, detectProject } = require('../process-lookup');
const { extractTitle } = require('../web-detect');
const { createStore } = require('../port-names');
const launchers = require('../launchers');

/* ------------------------------------------------------------------ *
 * Port catalogue
 * ------------------------------------------------------------------ */

test('the catalogue names the ports people actually run', () => {
  assert.equal(services.labelFor(80), 'Web Server');
  assert.equal(services.labelFor(443), 'Secure Web Server');
  assert.equal(services.labelFor(5432), 'PostgreSQL');
  assert.equal(services.labelFor(6379), 'Redis');
  assert.equal(services.labelFor(27017), 'MongoDB');
  assert.equal(services.labelFor(5173), 'Vite Dev Server');
  assert.equal(services.labelFor(4173), 'Vite Preview Server');
  assert.equal(services.labelFor(22), 'Secure Shell');
});

test('unknown ports have no label and fall into the other section', () => {
  assert.equal(services.labelFor(65431), null);
  assert.equal(services.serviceFor(65431), null);
  assert.equal(services.sectionFor(65431), 'other');
});

test('every catalogue entry has a label, a section and a known section', () => {
  for (const [port, entry] of Object.entries(services.PORT_CATALOG)) {
    assert.ok(entry.label, `port ${port} has no label`);
    assert.ok(entry.section, `port ${port} has no section`);
    assert.ok(
      services.SECTION_ORDER.includes(entry.section),
      `port ${port} has unknown section "${entry.section}"`
    );
    assert.ok(Number(port) > 0 && Number(port) < 65536, `port ${port} is out of range`);
  }
});

test('no port is defined twice', () => {
  const seen = new Set();
  for (const port of Object.keys(services.PORT_CATALOG)) {
    assert.ok(!seen.has(port), `port ${port} is listed more than once`);
    seen.add(port);
  }
});

test('the catalogue has a useful number of entries', () => {
  assert.ok(Object.keys(services.PORT_CATALOG).length > 150);
});

test('web ports are the ones that can be opened in a browser', () => {
  assert.ok(services.isWebPort(3000));
  assert.ok(services.isWebPort(4173));
  assert.ok(!services.isWebPort(5432));
  assert.equal(services.schemeFor(443), 'https');
  assert.equal(services.schemeFor(3000), 'http');
});

test('process names become readable labels', () => {
  assert.equal(services.processLabel('svchost.exe'), 'Windows Service');
  assert.equal(services.processLabel('node.exe'), 'Node.js Server');
  assert.equal(services.processLabel('jhi_service.exe'), 'Jhi Service');
  assert.equal(services.processLabel(null), null);
});

test('server headers are turned into framework names', () => {
  assert.equal(services.frameworkLabel('Vite'), 'Vite Dev Server');
  assert.equal(services.frameworkLabel('Next.js'), 'Next.js App');
  assert.equal(services.frameworkLabel('Express'), 'Express App');
  assert.equal(services.frameworkLabel('nginx/1.25.0'), 'nginx Web Server');
  assert.equal(services.frameworkLabel('SomethingUnknown'), null);
  assert.equal(services.frameworkLabel(null), null);
});

/* ------------------------------------------------------------------ *
 * Port lists and targets
 * ------------------------------------------------------------------ */

test('the port list honours the selected set', () => {
  const all = scanner.buildPortList('all', 1, 65535);
  assert.equal(all.length, 65535);
  assert.equal(all[0], 1);
  assert.equal(all[all.length - 1], 65535);

  const wellKnown = scanner.buildPortList('wellknown', 1, 65535);
  assert.equal(wellKnown.length, 1023);

  const registered = scanner.buildPortList('registered', 1, 65535);
  assert.equal(registered[0], 1024);
  assert.equal(registered[registered.length - 1], 49151);

  const dynamic = scanner.buildPortList('dynamic', 1, 65535);
  assert.equal(dynamic[0], 49152);

  const range = scanner.buildPortList('range', 8080, 8090);
  assert.equal(range.length, 11);
  assert.equal(range[0], 8080);

  const common = scanner.buildPortList('common', 1, 65535);
  assert.ok(common.includes(3000));
  assert.ok(common.includes(4173));
});

test('port numbers are clamped into range', () => {
  const range = scanner.buildPortList('range', -10, 99999);
  assert.equal(range[0], 1);
  assert.equal(range[range.length - 1], 65535);
});

test('localhost resolves to both loopback stacks', () => {
  const hosts = scanner.resolveHosts('localhost');
  assert.ok(hosts.includes('127.0.0.1'));
  assert.ok(hosts.includes('::1'));
});

test('a custom target is passed through untouched', () => {
  assert.deepEqual(scanner.resolveHosts('192.168.1.10'), ['192.168.1.10']);
  assert.deepEqual(scanner.resolveHosts('example.com'), ['example.com']);
});

/* ------------------------------------------------------------------ *
 * netstat parsing
 * ------------------------------------------------------------------ */

const NETSTAT_SAMPLE = `Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:135          0.0.0.0:0              LISTENING       1724
  TCP    127.0.0.1:139          0.0.0.0:0              LISTENING       4
  TCP    127.0.0.1:8080         127.0.0.1:51234        ESTABLISHED     900
  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4
  UDP    0.0.0.0:5353          *:*                                    7036
`;

test('netstat output is parsed into sockets', () => {
  const sockets = parseNetstat(NETSTAT_SAMPLE);

  // Every TCP row is kept, not just the listening ones: the owning process
  // of a port often only shows up on its established connections.
  assert.equal(sockets.length, 5);

  const tcp = sockets.filter((s) => s.proto === 'tcp');
  assert.equal(tcp.length, 4);

  const http = tcp.find((s) => s.port === 8080);
  assert.equal(http.state, 'ESTABLISHED');
  assert.equal(http.bound, false);

  const smb = tcp.find((s) => s.port === 445);
  assert.equal(smb.pid, 4);
  assert.equal(smb.bound, true);
  assert.equal(smb.address, '0.0.0.0');

  const udp = sockets.find((s) => s.proto === 'udp');
  assert.equal(udp.port, 5353);
  assert.equal(udp.pid, 7036);
});

test('a listening socket on the loopback keeps its address', () => {
  const sockets = parseNetstat(NETSTAT_SAMPLE);
  const rpc = sockets.find((s) => s.port === 135);
  assert.equal(rpc.address, '127.0.0.1');
});

test('empty or junk netstat output yields nothing', () => {
  assert.deepEqual(parseNetstat(''), []);
  assert.deepEqual(parseNetstat('not netstat output at all'), []);
});

/* ------------------------------------------------------------------ *
 * Project detection
 * ------------------------------------------------------------------ */

test('a python module is turned into an app name', () => {
  const project = detectProject(
    '"C:\\Python\\python.exe" -m mypackage.server gateway run'
  );
  assert.equal(project.name, 'Mypackage Gateway');
  assert.equal(project.source, 'module');
});

test('an npm package in node_modules is found', () => {
  const project = detectProject(
    '"C:\\Program Files\\nodejs\\node.exe" C:\\npm\\node_modules\\some-tool\\bin\\run.js'
  );
  assert.ok(project);
  assert.equal(project.source, 'npm package');
  assert.match(project.name, /some tool/);
});

test('a relative script path is ignored rather than misresolved', () => {
  assert.equal(detectProject('"C:\\nodejs\\node.exe" server.js'), null);
});

test('no command line means no project', () => {
  assert.equal(detectProject(''), null);
  assert.equal(detectProject(null), null);
});

/* ------------------------------------------------------------------ *
 * Page titles
 * ------------------------------------------------------------------ */

test('the page title is extracted from html', () => {
  assert.equal(extractTitle('<html><head><title>My App</title></head></html>'), 'My App');
});

test('a title mentioned in a comment is ignored', () => {
  const html = '<!-- <title>old</title> --><html><head><title>Real One</title></head></html>';
  assert.equal(extractTitle(html), 'Real One');
});

test('error pages are not treated as names', () => {
  assert.equal(extractTitle('<title>Bad Request</title>'), null);
  assert.equal(extractTitle('<title>Not Found</title>'), null);
  assert.equal(extractTitle('<title>Index</title>'), null);
});

test('entities in a title are decoded', () => {
  assert.equal(extractTitle('<title>Tom &amp; Jerry</title>'), 'Tom & Jerry');
});

/* ------------------------------------------------------------------ *
 * Port names
 * ------------------------------------------------------------------ */

test('names are saved, read back and removed', () => {
  const file = path.join(os.tmpdir(), `portview-test-${process.pid}.json`);
  try {
    const store = createStore(file);

    assert.deepEqual(store.all(), {});

    store.set(4173, { label: 'My Dashboard', section: 'apps' });
    assert.equal(store.get(4173).label, 'My Dashboard');
    assert.equal(store.get(4173).section, 'apps');

    // The name survives a fresh read from disk.
    const reopened = createStore(file);
    assert.equal(reopened.get(4173).label, 'My Dashboard');

    store.set(4173, { label: '' });
    assert.equal(store.get(4173), null);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('a missing names file is not an error', () => {
  const store = createStore(path.join(os.tmpdir(), `portview-missing-${process.pid}.json`));
  assert.deepEqual(store.all(), {});
  assert.equal(store.get(3000), null);
});

/* ------------------------------------------------------------------ *
 * Saved start commands
 * ------------------------------------------------------------------ */

test('a command line is split into the program and its arguments', () => {
  const parsed = launchers.parseCommandLine('"C:\\Program Files\\nodejs\\node.exe" app.js --port 3000');
  assert.equal(parsed.exe, 'C:\\Program Files\\nodejs\\node.exe');
  assert.deepEqual(parsed.args, ['app.js', '--port', '3000']);
});

test('a shell wrapper is unwrapped to the command a person would type', () => {
  assert.equal(
    launchers.unwrapShell('cmd.exe /d /s /c "npm run dev"'),
    'npm run dev'
  );
  assert.equal(
    launchers.unwrapShell('"C:\\Windows\\System32\\cmd.exe" /c "node server.js"'),
    'node server.js'
  );
});

test('a plain command is left alone', () => {
  assert.equal(
    launchers.unwrapShell('"C:\\Python\\python.exe" -m http.server 8000'),
    '"C:\\Python\\python.exe" -m http.server 8000'
  );
});

test('operating system processes are never launchable', () => {
  assert.ok(launchers.isSystemImage('svchost.exe'));
  assert.ok(launchers.isSystemImage('C:\\Windows\\System32\\lsass.exe'));
  assert.ok(launchers.isSystemImage('System'));
  assert.ok(!launchers.isSystemImage('node.exe'));
  assert.ok(!launchers.isSystemImage('python.exe'));
});

test('commands that look like they hold a credential are flagged', () => {
  assert.ok(launchers.looksSensitive('app --token abc123'));
  assert.ok(launchers.looksSensitive('app --api-key=xyz'));
  assert.ok(launchers.looksSensitive('app --password hunter2'));
  assert.ok(!launchers.looksSensitive('node server.js --port 3000'));
});

test('a program on disk is found, a made-up one is not', () => {
  assert.equal(launchers.findExecutable(process.execPath), process.execPath);
  assert.equal(launchers.findExecutable('definitely-not-a-real-program-xyz'), null);
});

test('the working directory comes from the script that was run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portview-cwd-'));
  const script = path.join(dir, 'server.js');
  try {
    fs.writeFileSync(script, '// test\n');
    assert.equal(launchers.inferCwd(`"${process.execPath}" "${script}"`), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a package directory wins over the script folder', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'portview-project-'));
  try {
    assert.equal(launchers.inferCwd('node server.js', project), project);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('start commands are remembered, read back and forgotten', () => {
  const file = path.join(os.tmpdir(), `portview-launchers-${process.pid}.json`);
  try {
    const store = launchers.createStore(file);

    store.remember({
      port: 4173,
      protocol: 'tcp',
      command: 'npm run preview',
      cwd: 'C:\\work\\app',
      label: 'My Dashboard',
      process: 'node.exe',
    });

    assert.equal(store.get(4173, 'tcp').command, 'npm run preview');
    assert.equal(store.get(4173, 'tcp').cwd, 'C:\\work\\app');

    const reopened = launchers.createStore(file);
    assert.equal(reopened.get(4173, 'tcp').label, 'My Dashboard');

    store.forget(4173, 'tcp');
    assert.equal(store.get(4173, 'tcp'), null);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('a command with a line break is refused', () => {
  const file = path.join(os.tmpdir(), `portview-launchers-bad-${process.pid}.json`);
  try {
    const store = launchers.createStore(file);
    assert.equal(store.remember({ port: 3000, command: 'node a.js\nrm -rf /' }), null);
    assert.equal(store.remember({ port: 3000, command: '   ' }), null);
    assert.equal(store.remember({ port: 99999, command: 'node a.js' }), null);
    assert.deepEqual(store.all(), {});
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('tcp and udp commands for the same port are kept apart', () => {
  const file = path.join(os.tmpdir(), `portview-launchers-proto-${process.pid}.json`);
  try {
    const store = launchers.createStore(file);
    store.remember({ port: 5353, protocol: 'tcp', command: 'tcp-app' });
    store.remember({ port: 5353, protocol: 'udp', command: 'udp-app' });

    assert.equal(store.get(5353, 'tcp').command, 'tcp-app');
    assert.equal(store.get(5353, 'udp').command, 'udp-app');
  } finally {
    fs.rmSync(file, { force: true });
  }
});
test('a relative script with no project folder is not guessed at', () => {
  assert.equal(launchers.inferCwd('"C:\\nodejs\\node.exe" server.js'), null);
});
test('runs of spaces are collapsed outside quotes but kept inside them', () => {
  assert.equal(
    launchers.normalizeCommand('"C:\\nodejs\\node.exe"   app.js'),
    '"C:\\nodejs\\node.exe" app.js'
  );
  assert.equal(
    launchers.normalizeCommand('app --name "two  spaces"'),
    'app --name "two  spaces"'
  );
});
