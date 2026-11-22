'use strict';

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

let state = { status: 'idle', open: [], scanned: 0, total: 0 };
const newKeys = new Set(); // ports to flash as newly discovered
let filterText = '';
let listeningOnly = false;
let launchTarget = null; // entry whose Start button was pressed

/* ------------------------------------------------------------------ *
 * Elements
 * ------------------------------------------------------------------ */

const el = {
  connDot: $('#connDot'),
  connText: $('#connText'),
  target: $('#target'),
  customField: $('#customField'),
  customTarget: $('#customTarget'),
  protocol: $('#protocol'),
  portSet: $('#portSet'),
  rangeField: $('#rangeField'),
  startPort: $('#startPort'),
  endPort: $('#endPort'),
  watch: $('#watch'),
  deepProbe: $('#deepProbe'),
  scanBtn: $('#scanBtn'),
  stopBtn: $('#stopBtn'),
  statOpen: $('#statOpen'),
  statScanned: $('#statScanned'),
  statTotal: $('#statTotal'),
  statDuration: $('#statDuration'),
  statStatus: $('#statStatus'),
  progressBar: $('#progressBar'),
  progressText: $('#progressText'),
  filter: $('#filter'),
  listeningOnly: $('#listeningOnly'),
  refreshBtn: $('#refreshBtn'),
  namesBtn: $('#namesBtn'),
  namesModal: $('#namesModal'),
  namesBody: $('#namesBody'),
  namesClose: $('#namesClose'),
  namesAdd: $('#namesAdd'),
  namesPath: $('#namesPath'),
  launchModal: $('#launchModal'),
  launchTitle: $('#launchTitle'),
  launchHint: $('#launchHint'),
  launchCommand: $('#launchCommand'),
  launchCwd: $('#launchCwd'),
  launchWarning: $('#launchWarning'),
  launchPath: $('#launchPath'),
  launchForget: $('#launchForget'),
  launchCancel: $('#launchCancel'),
  launchGo: $('#launchGo'),
  launchClose: $('#launchClose'),
  clearLog: $('#clearLog'),
  body: $('#portsBody'),
  empty: $('#emptyState'),
  log: $('#log'),
  hostInfo: $('#hostInfo'),
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function fmtDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s - m * 60).toFixed(0)}s`;
}

function fmtTime(t) {
  return new Date(t).toTimeString().slice(0, 8);
}

function keyOf(entry) {
  return `${entry.port}/${entry.protocol}`;
}

function sectionOrder() {
  return state.sectionOrder || ['apps', 'web', 'dev', 'database', 'messaging', 'remote', 'system', 'other'];
}

function sectionLabel(key) {
  return (state.sectionLabels && state.sectionLabels[key]) || key;
}

function sectionDescription(key) {
  return (state.sectionDescriptions && state.sectionDescriptions[key]) || '';
}

function matchesFilter(entry) {
  if (listeningOnly && entry.state !== 'listening') return false;
  if (!filterText) return true;
  const q = filterText;
  return (
    String(entry.port).includes(q) ||
    String(entry.label || '').toLowerCase().includes(q) ||
    String(entry.title || '').toLowerCase().includes(q) ||
    String(entry.service || '').toLowerCase().includes(q) ||
    String(entry.process || '').toLowerCase().includes(q) ||
    String(entry.pid || '').includes(q) ||
    String(entry.state || '').toLowerCase().includes(q) ||
    (entry.addresses || []).join(' ').includes(q)
  );
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (__) { /* ignore */ }
    ta.remove();
  }
  addLog(`Copied ${text} to clipboard`, 'info');
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function renderStats() {
  el.statOpen.textContent = fmtNum(state.openCount !== undefined ? state.openCount : state.open.length);
  el.statScanned.textContent = fmtNum(state.scanned);
  el.statTotal.textContent = fmtNum(state.total);

  const dur = state.durationMs;
  el.statDuration.textContent = state.status === 'scanning' ? 'running' : fmtDuration(dur);

  el.statStatus.textContent = state.status;
  el.statStatus.className = 'stat-value small ' + state.status;

  const pct = state.total ? Math.min(100, (state.scanned / state.total) * 100) : 0;
  el.progressBar.style.width = state.status === 'scanning' ? pct + '%' : (state.total ? '100%' : '0%');

  if (state.status === 'scanning') {
    el.progressText.textContent = `scanning ${fmtNum(state.scanned)} / ${fmtNum(state.total)} (${pct.toFixed(1)}%)`;
  } else if (state.status === 'complete') {
    const listening = state.open.filter((e) => e.state === 'listening').length;
    el.progressText.textContent = `complete — ${fmtNum(state.open.length)} open (${listening} listening) in ${fmtDuration(dur)}`;
  } else if (state.status === 'cancelled') {
    el.progressText.textContent = `cancelled at ${fmtNum(state.scanned)} / ${fmtNum(state.total)}`;
  } else if (state.status === 'error') {
    el.progressText.textContent = `error: ${state.error || 'unknown'}`;
  } else {
    el.progressText.textContent = 'idle';
  }

  const running = state.status === 'scanning';
  el.scanBtn.disabled = running;
  el.stopBtn.disabled = !running;
  el.scanBtn.querySelector('.btn-label').textContent = running ? 'Scanning…' : 'Scan';
}

function renderTable() {
  const entries = state.open.filter(matchesFilter).sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));

  el.body.innerHTML = '';

  // Group the ports into named sections.
  const groups = new Map();
  for (const entry of entries) {
    const section = entry.section || 'other';
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(entry);
  }

  const ordered = sectionOrder().filter((s) => groups.has(s));
  for (const extra of groups.keys()) {
    if (!ordered.includes(extra)) ordered.push(extra);
  }

  let shown = 0;

  for (const section of ordered) {
    const rows = groups.get(section);
    shown += rows.length;

    const head = document.createElement('tr');
    head.className = 'section-head';
    head.innerHTML = `
      <td colspan="9">
        <span class="section-title"></span>
        <span class="section-count">${rows.length}</span>
        <span class="section-hint"></span>
      </td>
    `;
    head.querySelector('.section-title').textContent = sectionLabel(section);
    head.querySelector('.section-hint').textContent = sectionDescription(section);
    el.body.appendChild(head);

    for (const entry of rows) {
      el.body.appendChild(buildRow(entry));
    }
  }

  newKeys.clear();

  const hasRows = shown > 0;
  el.empty.classList.toggle('hidden', hasRows);
  if (!hasRows && (filterText || listeningOnly)) {
    el.empty.querySelector('p').textContent = 'No ports match the current filter.';
    el.empty.querySelector('span').textContent = 'Clear the filter to see every open port.';
  } else {
    el.empty.querySelector('p').textContent = 'No open ports found yet.';
    el.empty.querySelector('span').innerHTML = 'Press <kbd>Scan</kbd> to probe every port on this machine.';
  }
}

function buildRow(entry) {
  const tr = document.createElement('tr');
  if (newKeys.has(keyOf(entry))) tr.className = 'new';
  if (entry.state === 'stopped') tr.className += ' stopped';

  const proto = entry.protocol === 'udp' ? 'udp' : 'tcp';
  const isListening = entry.state === 'listening';
  const isStopped = entry.state === 'stopped';

  const name = entry.label || entry.title || entry.service || null;

  tr.innerHTML = `
    <td class="port-num">${entry.port}</td>
    <td class="name-cell" title="Click to name this port">
      <span class="port-name"></span>
      ${entry.custom ? '<span class="badge-custom">named</span>' : ''}
    </td>
    <td><span class="pill pill-${proto}">${proto.toUpperCase()}</span></td>
    <td><span class="pill ${isListening ? 'pill-listen' : isStopped ? 'pill-stopped' : 'pill-open'}">${
      isListening ? 'LISTENING' : isStopped ? 'STOPPED' : 'OPEN'
    }</span></td>
    <td class="${entry.service ? 'svc' : 'svc-none'}">${entry.service || '—'}</td>
    <td class="pid">${entry.pid || '—'}</td>
    <td class="proc">${entry.process || '—'}</td>
    <td class="addr">${(entry.addresses || []).join(', ')}</td>
    <td class="open-cell"></td>
  `;

  const nameEl = tr.querySelector('.port-name');
  nameEl.textContent = name || '—';
  if (!name) nameEl.classList.add('svc-none');
  if (entry.custom) nameEl.classList.add('named');

  // Open in a browser. An anchor is used rather than window.open so that
  // popup blockers do not get in the way. A stopped port has nothing to open.
  if (entry.url && !isStopped) {
    const link = document.createElement('a');
    link.className = 'btn btn-open';
    link.textContent = 'Open';
    link.href = entry.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = `Open ${entry.url} in your browser`;
    link.addEventListener('click', () => addLog(`Opening ${entry.url}`, 'info'));
    tr.querySelector('.open-cell').appendChild(link);
  }

  // Restart a port that is down, using the command PortView remembered.
  if (entry.canLaunch) {
    const start = document.createElement('button');
    start.className = 'btn btn-start';
    start.textContent = 'Start';
    start.title = `Run the app that used to listen on port ${entry.port}`;
    start.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openLaunchModal(entry);
    });
    tr.querySelector('.open-cell').appendChild(start);
  }

  // Name / rename.
  tr.querySelector('.name-cell').addEventListener('click', (ev) => {
    ev.stopPropagation();
    promptForName(entry);
  });

  tr.title = [
    name || `port ${entry.port}`,
    entry.projectPath ? `project: ${entry.projectPath}` : null,
    entry.title ? `page title: ${entry.title}` : null,
    'click the name to rename it',
  ]
    .filter(Boolean)
    .join('\n');
  tr.addEventListener('click', () => {
    const host = (entry.addresses && entry.addresses[0]) || 'localhost';
    copyText(`${host}:${entry.port}`);
  });

  return tr;
}

/**
 * Ask the user for a name for a port and save it.
 */
async function promptForName(entry) {
  const current = entry.custom ? entry.label || '' : '';
  const suggestion = current || entry.title || entry.label || '';

  const input = window.prompt(
    `Name for port ${entry.port}:\n\n` +
      `This is saved in port-names.json and shown next to the port. ` +
      `Leave it empty to clear a custom name.`,
    suggestion
  );

  if (input === null) return;

  const label = input.trim();
  try {
    const res = await fetch('/api/names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: entry.port, label }),
    });
    const body = await res.json();
    if (!body.ok) {
      addLog(body.error || 'Could not save the name.', 'error');
      return;
    }
    addLog(label ? `Named port ${entry.port} "${label}".` : `Cleared the name for port ${entry.port}.`, 'info');
  } catch (err) {
    addLog(`Could not save the name: ${err.message}`, 'error');
  }
}

function addLog(line, level = 'info') {
  const div = document.createElement('div');
  div.className = 'log-line ' + level;
  div.innerHTML = `<span class="log-time">${fmtTime(Date.now())}</span><span class="log-text"></span>`;
  div.querySelector('.log-text').textContent = line;
  el.log.appendChild(div);
  while (el.log.children.length > 400) el.log.removeChild(el.log.firstChild);
  el.log.scrollTop = el.log.scrollHeight;
}

function setConn(mode, text) {
  el.connDot.className = 'dot ' + mode;
  el.connText.textContent = text;
}

/**
 * Parse an SSE payload. A malformed frame must never break the viewer.
 */
function parseEvent(e) {
  try {
    return JSON.parse(e.data);
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Server events (SSE)
 * ------------------------------------------------------------------ */

function connect() {
  const es = new EventSource('/api/events');

  es.addEventListener('open', () => setConn('dot-live', 'live'));
  es.addEventListener('error', () => setConn('dot-error', 'reconnecting…'));

  es.addEventListener('state', (e) => {
    const s = parseEvent(e);
    if (!s) return;
    state = s;
    renderStats();
    renderTable();
  });

  es.addEventListener('progress', (e) => {
    const p = parseEvent(e);
    if (!p) return;
    state.scanned = p.scanned;
    state.total = p.total;
    renderStats();
  });

  es.addEventListener('port', (e) => {
    // Track freshly discovered ports so the table can flash them.
    // NB: this must not be called "open" - EventSource already has a built-in
    // event with that name, and the two would collide.
    const entry = parseEvent(e);
    if (entry) newKeys.add(keyOf(entry));
  });

  es.addEventListener('log', (e) => {
    const entry = parseEvent(e);
    if (entry) addLog(entry.line, entry.level);
  });

  es.addEventListener('done', (e) => {
    const s = parseEvent(e);
    if (!s) return;
    state = s;
    renderStats();
    renderTable();
  });

  return es;
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

function buildScanOptions() {
  let target = el.target.value;
  if (target === 'custom') {
    target = el.customTarget.value.trim() || 'localhost';
  }
  return {
    target,
    protocol: el.protocol.value,
    portSet: el.portSet.value,
    startPort: Number(el.startPort.value) || 1,
    endPort: Number(el.endPort.value) || 65535,
    deep: el.deepProbe.checked,
  };
}

async function runScan() {
  const opts = buildScanOptions();
  el.scanBtn.disabled = true;
  el.scanBtn.querySelector('.btn-label').textContent = 'Scanning…';
  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    const body = await res.json();
    if (!body.ok) addLog(body.reason || 'Could not start scan.', 'warn');
  } catch (err) {
    addLog(`Request failed: ${err.message}`, 'error');
    el.scanBtn.disabled = false;
    el.scanBtn.querySelector('.btn-label').textContent = 'Scan';
  }
}

async function stopScan() {
  try {
    const res = await fetch('/api/stop', { method: 'POST' });
    const body = await res.json();
    if (!body.ok) addLog(body.reason || 'Nothing to stop.', 'warn');
  } catch (err) {
    addLog(`Request failed: ${err.message}`, 'error');
  }
}

async function refreshProcesses() {
  el.refreshBtn.textContent = '…';
  try {
    await fetch('/api/processes', { method: 'POST' });
    addLog('Re-resolved listening processes.', 'info');
  } catch (err) {
    addLog(`Refresh failed: ${err.message}`, 'error');
  }
  el.refreshBtn.textContent = 'Processes';
}

/* ------------------------------------------------------------------ *
 * Names manager
 * ------------------------------------------------------------------ */

async function openNamesModal() {
  el.namesModal.classList.remove('hidden');
  await renderNames();
}

function closeNamesModal() {
  el.namesModal.classList.add('hidden');
}

async function renderNames() {
  let names = {};
  try {
    const res = await fetch('/api/names');
    names = await res.json();
  } catch (err) {
    el.namesBody.innerHTML = `<div class="modal-empty">Could not load names: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const ports = Object.keys(names).sort((a, b) => Number(a) - Number(b));
  el.namesPath.textContent = 'port-names.json';

  if (!ports.length) {
    el.namesBody.innerHTML =
      '<div class="modal-empty">No custom names yet.<br>Click any name in the table to set one.</div>';
    return;
  }

  el.namesBody.innerHTML = '';
  for (const port of ports) {
    const entry = names[port];
    const row = document.createElement('div');
    row.className = 'modal-row';

    const portEl = document.createElement('span');
    portEl.className = 'modal-port';
    portEl.textContent = port;

    const nameEl = document.createElement('span');
    nameEl.className = 'modal-name';
    nameEl.textContent = entry.label || '(no label)';

    const edit = document.createElement('button');
    edit.className = 'btn btn-mini';
    edit.textContent = 'Rename';
    edit.addEventListener('click', async () => {
      const next = window.prompt(`Name for port ${port}:`, entry.label || '');
      if (next === null) return;
      await saveName(port, next.trim());
    });

    const remove = document.createElement('button');
    remove.className = 'btn btn-mini';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      await saveName(port, '');
    });

    row.append(portEl, nameEl, edit, remove);
    el.namesBody.appendChild(row);
  }
}

async function saveName(port, label) {
  try {
    const res = await fetch('/api/names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port, label }),
    });
    const body = await res.json();
    if (!body.ok) {
      addLog(body.error || 'Could not save the name.', 'error');
      return;
    }
    addLog(label ? `Named port ${port} "${label}".` : `Cleared the name for port ${port}.`, 'info');
    await renderNames();
  } catch (err) {
    addLog(`Could not save the name: ${err.message}`, 'error');
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/* ------------------------------------------------------------------ *
 * Starting a closed port
 * ------------------------------------------------------------------ */

async function openLaunchModal(entry) {
  launchTarget = entry;

  el.launchTitle.textContent = `Start ${entry.label || `port ${entry.port}`}`;
  el.launchPath.textContent = `port ${entry.port} / ${entry.protocol}`;
  el.launchHint.textContent = 'Loading the command PortView remembered…';
  el.launchCommand.value = '';
  el.launchCwd.value = '';
  el.launchWarning.classList.add('hidden');
  el.launchGo.disabled = true;
  el.launchModal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/launchers?port=${entry.port}&protocol=${entry.protocol}`);
    const saved = await res.json();
    if (!res.ok) throw new Error(saved.error || 'No saved command for that port.');

    el.launchCommand.value = saved.command || '';
    el.launchCwd.value = saved.cwd || '';
    el.launchWarning.classList.toggle('hidden', !saved.sensitive);
    el.launchHint.textContent =
      `This is how ${saved.label || `port ${entry.port}`} was started before. ` +
      'Check the command before running it — it will execute on this machine.';
    el.launchGo.disabled = false;
  } catch (err) {
    el.launchHint.textContent = `Could not load the saved command: ${err.message}`;
  }
}

function closeLaunchModal() {
  el.launchModal.classList.add('hidden');
  launchTarget = null;
}

async function doLaunch() {
  if (!launchTarget) return;

  el.launchGo.disabled = true;
  el.launchGo.textContent = 'Starting…';

  try {
    const res = await fetch('/api/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        port: launchTarget.port,
        protocol: launchTarget.protocol,
        command: el.launchCommand.value,
        cwd: el.launchCwd.value,
      }),
    });
    const body = await res.json();

    if (!body.ok) {
      addLog(body.reason || body.error || 'Could not start it.', 'error');
      return;
    }

    addLog(
      `Started ${launchTarget.label || `port ${launchTarget.port}`}` +
        (body.pid ? ` (pid ${body.pid})` : '') + '.',
      'info'
    );
    closeLaunchModal();
  } catch (err) {
    addLog(`Launch failed: ${err.message}`, 'error');
  } finally {
    el.launchGo.disabled = false;
    el.launchGo.textContent = 'Start';
  }
}

async function forgetLaunch() {
  if (!launchTarget) return;

  try {
    const res = await fetch('/api/launchers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: launchTarget.port, protocol: launchTarget.protocol }),
    });
    const body = await res.json();
    if (!body.ok) {
      addLog(body.error || 'Could not forget that command.', 'error');
      return;
    }
    addLog(`Forgot the start command for port ${launchTarget.port}.`, 'info');
    closeLaunchModal();
  } catch (err) {
    addLog(`Could not forget that command: ${err.message}`, 'error');
  }
}

async function applyWatch() {
  const intervalMs = Number(el.watch.value) || 0;
  try {
    await fetch('/api/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervalMs }),
    });
  } catch (err) {
    addLog(`Watch update failed: ${err.message}`, 'error');
  }
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

el.target.addEventListener('change', () => {
  el.customField.classList.toggle('hidden', el.target.value !== 'custom');

  const remote = el.target.value === 'lan' || el.target.value === 'all' || el.target.value === 'custom';
  if (remote && !el.deepProbe.checked) {
    el.deepProbe.checked = true;
    addLog('Deep probe is required for remote targets — re-enabled.', 'warn');
  }

  // The OS listener table only describes this machine, so the "listening
  // only" filter is meaningless for a remote target.
  el.listeningOnly.disabled = remote;
  if (remote) el.listeningOnly.checked = false;

  if (el.target.value === 'lan' || el.target.value === 'all') {
    if (el.portSet.value === 'all') el.portSet.value = 'common';
  } else if (el.portSet.value === 'common' && el.target.value === 'localhost') {
    el.portSet.value = 'all';
  }
});

el.portSet.addEventListener('change', () => {
  el.rangeField.classList.toggle('hidden', el.portSet.value !== 'range');
});

el.scanBtn.addEventListener('click', runScan);
el.stopBtn.addEventListener('click', stopScan);
el.refreshBtn.addEventListener('click', refreshProcesses);
el.watch.addEventListener('change', applyWatch);
el.namesBtn.addEventListener('click', openNamesModal);
el.namesClose.addEventListener('click', closeNamesModal);
el.namesAdd.addEventListener('click', async () => {
  const input = window.prompt('Port number to name:');
  if (input === null) return;
  const port = Number(input);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    addLog('That is not a valid port number.', 'warn');
    return;
  }
  const label = window.prompt(`Name for port ${port}:`);
  if (label === null) return;
  await saveName(port, label.trim());
});

el.namesModal.addEventListener('click', (e) => {
  if (e.target === el.namesModal) closeNamesModal();
});

el.launchClose.addEventListener('click', closeLaunchModal);
el.launchCancel.addEventListener('click', closeLaunchModal);
el.launchGo.addEventListener('click', doLaunch);
el.launchForget.addEventListener('click', forgetLaunch);
el.launchModal.addEventListener('click', (e) => {
  if (e.target === el.launchModal) closeLaunchModal();
});

el.clearLog.addEventListener('click', () => {
  el.log.innerHTML = '';
});

el.filter.addEventListener('input', () => {
  filterText = el.filter.value.trim().toLowerCase();
  renderTable();
});

el.listeningOnly.addEventListener('change', () => {
  listeningOnly = el.listeningOnly.checked;
  renderTable();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!el.scanBtn.disabled) runScan();
  }
  if (e.key === 'Escape') {
    if (!el.launchModal.classList.contains('hidden')) {
      closeLaunchModal();
      return;
    }
    if (!el.namesModal.classList.contains('hidden')) {
      closeNamesModal();
      return;
    }
    el.filter.value = '';
    filterText = '';
    renderTable();
  }
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

(async function boot() {
  try {
    const res = await fetch('/api/state');
    state = await res.json();
    el.hostInfo.textContent = state.hostInfo || '';
    renderStats();
    renderTable();
  } catch (err) {
    addLog(`Could not load initial state: ${err.message}`, 'error');
  }
  connect();
})();
