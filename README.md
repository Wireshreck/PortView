# PortView

A local port scanner with a live web viewer, served on **http://localhost:6969**.

PortView answers the question *"what ports are open on this machine?"* and shows
the answer with the owning process for each port.

[![CI](https://github.com/Wireshreck/PortView/actions/workflows/ci.yml/badge.svg)](https://github.com/Wireshreck/PortView/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Quick start

```bash
git clone <this repository>
cd portview
npm start          # or: node server.js
```

Then open <http://localhost:6969>.

On Windows you can also double-click `start.bat`, which launches the server and
opens your browser.

No dependencies — just Node.js 18 or newer.

### Start at login (Windows)

```powershell
npm run startup:install
```

This puts a **PortView** shortcut in your Startup folder. It runs
`server.js --startup` hidden through `wscript.exe`, so no console window
appears, and it shows up in **Settings → Apps → Startup** (and Task Manager →
Startup apps) where it can be switched off like any other app. The server starts
listening immediately and scans the local TCP ports as soon as it is up.

To stop starting at login:

```powershell
npm run startup:uninstall
```

The shortcut points at this checkout. If you move the folder, run
`startup:install` again. Ports opened later can still be refreshed from the
page; the login scan just means the table is already filled in when you open it.

## What it shows

| Column | Meaning |
| --- | --- |
| **PORT** | The port number |
| **NAME** | What the port is called (see below) |
| **PROTO** | TCP or UDP |
| **STATE** | `LISTENING` — the OS confirms a socket bound to this port. `OPEN` — only a TCP probe succeeded. |
| **SERVICE** | Well-known service name for the port, when there is one |
| **PID** | Process id that owns the socket |
| **PROCESS** | Process image name (`node.exe`, `svchost.exe`, …) |
| **ADDRESS** | Bind addresses the port answers on |
| **Open** | Opens the port in your browser, when it speaks HTTP |
| **Start** | Runs the app that used to own the port, when it is down |

Click any row to copy `host:port`. Click a **name** to rename it.

## Naming your ports

Every open port gets a name, worked out from six sources, best first:

1. **A name you set** — click the name in the table and type one. It is saved
   to `port-names.json` and shown next to the port from then on.
2. **The page title** — PortView fetches `http://localhost:<port>/` and reads
   the `<title>`, so a dev server that calls itself "My Dashboard" is
   labelled "My Dashboard".
3. **The project it belongs to** — the command line of the owning process is
   resolved to its package, its `package.json`, or its Python module.
   `python -m mypackage.server gateway run` becomes "Mypackage Gateway";
   a globally installed npm package takes the name from its own manifest.
4. **The framework** — the `Server` and `X-Powered-By` response headers name
   the stack: Vite, Next.js, Express, Django, Flask, Jupyter and so on.
5. **The Windows service** — ports owned by `svchost.exe` are matched against
   the service list, so they read "Credential Manager" or "Windows Event Log"
   rather than "Windows Service".
6. **A built-in catalogue** — 189 known ports, covering web servers, dev
   tooling, databases, queues, remote access, media servers and proxies.

### Sections

Ports are grouped into sections so you can find what you are after:

| Section | What lands here |
| --- | --- |
| **Your Apps** | Ports you have named, and local projects that were detected |
| **Web & Browsable** | HTTP endpoints, each with an **Open** button |
| **Dev Servers & Tooling** | Vite, Storybook, Angular, Docker, Chrome DevTools |
| **Databases** | PostgreSQL, MySQL, MongoDB, Redis, Elasticsearch, InfluxDB … |
| **Messaging & Queues** | RabbitMQ, Kafka, MQTT, NATS, ZooKeeper, ActiveMQ … |
| **Remote Access** | SSH, RDP, VNC, FTP, SMB, NFS |
| **Media Servers** | Plex, Jellyfin, Synology DSM, UPnP |
| **Proxies & Gateways** | Squid, SOCKS, Tor |
| **System & Core** | RPC, NetBIOS, DNS, NTP, WSD, Kubelet, named Windows services |
| **Other Open Ports** | Everything else |

### Managing names

The **Names** button in the table toolbar opens a list of every name you have
set, with rename and remove buttons. Names live in `port-names.json`:

```json
{
  "4173": {
    "label": "My Dashboard",
    "section": "apps"
  }
}
```

`label` is what you see next to the port. `section` is optional and overrides
the automatic grouping. `url` is optional too, and sets the address the
**Open** button points at.

> `port-names.json` is your own data, so it is listed in `.gitignore` and is
> never committed. To start from the example, copy
> `port-names.example.json` to `port-names.json`.

## Starting a closed port

While a scan runs, PortView records how each listening app was started: the
command line of the owning process, its working directory and the name it was
shown under. When that app is closed, its row stays in **Your Apps** with a
**Start** button, and pressing it runs the same command again.

The dialog shows the command before anything happens, and both the command and
the working directory are editable, so a saved command that has drifted can be
corrected without editing a file.

Only processes a person could plausibly have started are recorded. The kernel,
Windows service hosts and shell plumbing are skipped, and a command started as
`cmd.exe /c npm run dev` is unwrapped to `npm run dev`. Commands that reference
a relative script are not recorded, because Windows does not report a process's
working directory and guessing would store something that cannot run.

Remembered commands live in `launchers.json`, keyed by port and protocol:

```json
{
  "4173/tcp": {
    "port": 4173,
    "protocol": "tcp",
    "command": "npm run preview",
    "cwd": "C:\\work\\dashboard",
    "label": "My Dashboard",
    "process": "node.exe",
    "capturedAt": 1795334585344
  }
}
```

> `launchers.json` holds command lines, and command lines can contain paths or
> flags you would rather keep to yourself. It is gitignored, like
> `port-names.json`, and is never sent anywhere. **Forget** in the dialog
> removes an entry.

A few things are refused on purpose: a port that is already open, an operating
system process (`svchost.exe`, `lsass.exe`, …), a program that is not on this
machine, and a launch request that did not come from the viewer's own origin.

## How it works

A scan runs in two phases.

**Phase 1 — OS socket table (local targets, ~2 seconds).**
The kernel's own view of every socket is read via `Get-NetTCPConnection` /
`Get-NetUDPEndpoint` on Windows and `ss` elsewhere. The same PowerShell call
also reads the process table, so a scan pays for one shell start rather than
three. The candidate ports are then probed to confirm they really accept
connections, and each one is matched back to its owning process. This is the
authoritative answer and it lands in the UI almost immediately.

**Phase 2 — deep probe sweep (optional, background).**
Every port in the selected range is probed with a TCP connect (or a UDP
datagram). This is what makes remote targets possible, since there is no local
socket table for another machine.

### Why the two phases

Windows makes a naive connect scan unreliable in two ways, and both are handled
here:

* **A refused port can still accept a connection.** Windows keeps the local
  port reserved after a socket closes, and `connect()` to a reserved port
  succeeds. A pure probe scan therefore reports thousands of phantom "open"
  ports on a busy machine. Phase 1 cross-checks every hit against the OS
  socket table, so a port is only reported when the kernel says something is
  bound to it.
* **The OS socket table is itself incomplete.** `Get-NetTCPConnection -State
  Listen` misses real listeners on some Windows builds, because the kernel
  reports state values the module cannot map. PortView therefore fetches every
  row and classifies them locally instead of trusting the `-State` filter.

The `LISTENING` / `OPEN` column shows which check each row passed.

For UDP, a port is only reported when it actually answers. UDP has no
handshake, so silence proves nothing — on Windows the ICMP port-unreachable
reply is not surfaced to the socket at all.

## Controls

| Control | Description |
| --- | --- |
| **Target** | This machine, a specific loopback address, your LAN addresses, everything, or a custom host |
| **Protocol** | TCP or UDP |
| **Port range** | All 65535, common ports, well-known, registered, dynamic, or a custom range |
| **Watch** | Re-scan automatically on an interval |
| **Deep probe** | Off means "OS socket table only" — instant results, local targets |
| **Filter** | Filter by port, service, process, PID or address |
| **listening only** | Show only OS-confirmed ports (disabled for remote targets) |
| **JSON / CSV** | Export the current results |

Keyboard: `Ctrl`/`Cmd` + `Enter` starts a scan, `Escape` clears the filter.

## API

All endpoints return JSON.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/state` | GET | Current scan state and results |
| `/api/events` | GET | Server-sent event stream (`state`, `port`, `progress`, `log`, `done`) |
| `/api/scan` | POST | Start a scan — `{ target, protocol, portSet, startPort, endPort, deep }` |
| `/api/stop` | POST | Cancel the running scan |
| `/api/watch` | POST | Set the rescan interval in ms, `0` to disable |
| `/api/processes` | POST | Re-resolve process names for the current results |
| `/api/names` | GET | All custom port names |
| `/api/names` | POST | Set a name — `{ port, label, url?, section? }` |
| `/api/names` | DELETE | Remove a name — `{ port }` |
| `/api/launchers` | GET | Every saved start command, or one with `?port=…&protocol=…` |
| `/api/launch` | POST | Run the saved command — `{ port, protocol?, command?, cwd? }` |
| `/api/launchers` | DELETE | Forget a saved command — `{ port, protocol? }` |
| `/api/export?format=json\|csv` | GET | Download the results |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `6969` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address. Keep it on loopback unless you intend to expose the tool |
| `PORTVIEW_STARTUP` | unset | `1` acts like `--startup`: scan at boot and exit quietly if the port is already taken |

```bash
PORT=8080 node server.js
```

On Windows, `start.bat` opens the same port that `PORT` sets (6969 by default).

## Layout

```
server.js          HTTP server, SSE stream, scan orchestration
scanner.js         TCP/UDP probing and target resolution
process-lookup.js  OS socket table, process names and project detection
web-detect.js      Page title and content type detection
port-names.js      Your saved port names (port-names.json)
launchers.js       Remembered start commands (launchers.json)
services.js        Port catalogue: names, labels and sections
scripts/smoke.js   Start, check and stop the server, as CI does
scripts/startup.vbs           Hidden launcher used at login
scripts/install-startup.ps1   Register the login shortcut
scripts/uninstall-startup.ps1 Remove it again
public/            The viewer (no build step, no framework)
test/              Tests, run with `npm test`
```

## Development

```bash
npm test      # 39 tests, no dependencies
npm run lint  # syntax check across every file
npm run smoke # start the server on a spare port and check it answers
```

## Contributing

Bug reports and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
Please strip personal details (hostnames, IP addresses, usernames, absolute
paths) out of anything you paste into an issue; the issue template asks for it.

## Security

PortView reads the listening sockets on your machine and shows which process
owns each one. It can also run the start command it saved for a port that is
down, so treat it as you would a shell on that machine. It binds to
`127.0.0.1` by default, so nothing outside your machine can reach it — please
keep it that way on shared networks. See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 PortView contributors

