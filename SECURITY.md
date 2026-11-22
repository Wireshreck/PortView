# Security

## What PortView does

PortView reads the list of listening sockets on your machine, works out which
process owns each one, and serves that information over HTTP. It can also run
the start command it recorded for a port that is currently down, which makes
the viewer as powerful as a shell on that machine.

## The default is safe

The server binds to `127.0.0.1` by default, so nothing outside your own
machine can reach it. Keep it that way unless you have a reason not to.

**Do not set `HOST=0.0.0.0` on a network you do not control.** The viewer
exposes the names of every running process, the ports they listen on and the
addresses of your machine. With the launch feature reachable, anyone on that
network could also start programs on it. That is useful to you and useful to
an attacker.

## Starting programs

The launch endpoint only runs a command that PortView itself recorded, or one
typed into the confirmation dialog by the person at the keyboard. It refuses
operating system processes, an already-open port and cross-origin requests,
and it checks that the program still exists before running it. The command and
working directory are shown before anything starts.

## Reporting a problem

If you find a vulnerability in PortView, please report it privately through
GitHub's security advisory form for this repository rather than as a public
issue, and give the maintainers a reasonable amount of time to publish a fix
before disclosing it publicly.

## What is not collected

There is no telemetry, no analytics and no network access to anything outside
your machine. The only files PortView writes are `port-names.json`, which holds
the names you give your own ports, and `launchers.json`, which holds the
commands behind them so a closed port can be started again. Both are listed in
`.gitignore` so they never end up in a commit.
