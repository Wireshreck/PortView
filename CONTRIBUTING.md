# Contributing

Thanks for helping out. PortView is small and has no dependencies, so there is
not much ceremony.

## Getting set up

```bash
git clone <your fork>
cd portview
npm test          # 38 tests, no dependencies needed
npm start         # http://localhost:6969
```

Node.js 18 or newer is required. There is nothing to install and nothing to
build — the viewer is plain HTML, CSS and JavaScript.

## Making a change

1. Open an issue first for anything larger than a bug fix, so the approach
   can be agreed on before you write it.
2. Keep the dependency count at zero. PortView works by talking to the OS, and
   every dependency is a thing that can break or need updating.
3. Add a test for any behaviour you change. The tests live in
   `test/portview.test.js` and use the built-in runner:

   ```bash
   npm test
   ```

4. Run `npm run lint` before you push. It is a syntax check across every file.

## Style

- Two space indentation, semicolons, single quotes.
- `const` over `let` unless the value really is reassigned.
- Comments explain *why*, not *what*.
- Keep the platform-specific code in `process-lookup.js` so the rest of the app
  stays portable.

## What not to commit

- `port-names.json` — your own port names. It is personal and is gitignored.
- `launchers.json` — the commands behind your ports. Also personal, and also
  gitignored.
- Anything from your machine that identifies you: hostnames, IP addresses,
  usernames, absolute paths.

The CI workflow checks the syntax and runs the tests on Windows, macOS and
Linux, so please make sure it passes there.

## Reporting bugs

Use the bug report template. It asks you to strip personal details out of
the output you paste, which makes the report both safer for you and easier to
act on.
