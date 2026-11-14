# Security

## What PortView does

PortView reads the list of listening sockets on your machine, works out which
process owns each one, and serves that information over HTTP.

## The default is safe

The server binds to `127.0.0.1` by default, so nothing outside your own
machine can reach it. Keep it that way unless you have a reason not to.

**Do not set `HOST=0.0.0.0` on a network you do not control.** The viewer
exposes the names of every running process, the ports they listen on and the
addresses of your machine. That is useful to you and useful to an attacker.

## Reporting a problem

If you find a vulnerability in PortView, please report it privately through
GitHub's security advisory form for this repository rather than as a public
issue, and give the maintainers a reasonable amount of time to publish a fix
before disclosing it publicly.

## What is not collected

There is no telemetry, no analytics and no network access to anything outside
your machine. The only file PortView writes is `port-names.json` in the
project directory, which holds the names you give your own ports. It is listed
in `.gitignore` so it never ends up in a commit.
