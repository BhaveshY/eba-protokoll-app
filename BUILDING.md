# Building installers

End users should just download the release artifacts — see
[README.md](README.md). This file is for producing those artifacts.


## Prerequisites

- Node.js 20+ (tested on 22+)
- macOS for Mac builds, Windows for `.exe` builds (cross-compile is messy
  and not attempted here)

```bash
npm install
```


## Windows: `EBA-Protokoll-Setup-<version>.exe`

Run on Windows:

```bash
npm run dist:win
```

Output in `release/`: an NSIS installer `.exe`. Per-user install, Start
Menu + Desktop shortcut, optional runAfterFinish.

The installer is **not signed**. Windows SmartScreen will warn once.
To remove the warning, buy a commercial code-signing cert and configure
`win.certificateFile` in `electron-builder.yml`.


## macOS: `EBA-Protokoll-<version>-arm64-mac.zip` + x64 variant

Run on macOS:

```bash
npm run dist:mac
```

Output in `release/`: two zips (arm64 + x64). Each contains a proper
`.app` bundle.

`electron-builder.yml` sets `identity: null` and `hardenedRuntime: false`
so the build succeeds without an Apple Developer ID. The `.app` is **not
notarized** — users right-click → Open on first launch. That's unavoidable
without the paid Developer Program.

To notarize later:
1. Join the Apple Developer Program (99 USD/year).
2. Set `identity` to your Developer ID Application cert and remove the
   `identity: null` override.
3. Add `afterSign` hook calling `@electron/notarize`.


## Linux: `EBA-Protokoll-<version>-x64.AppImage`

Run on Linux (or macOS, cross-compile works here):

```bash
npm run dist
```

An AppImage is produced. Users make it executable and double-click.


## Running locally in dev

```bash
npm run dev
```

Starts Vite on :5173 and an Electron window pointing at it.
DevTools open automatically.


## Tests

```bash
npm test           # run once
npm run test:watch # watch mode
```

Unit tests cover Deepgram client retry/cancel logic, response mapping,
transcript formatting, keyterm handling. Browser-only APIs (MediaRecorder,
AudioContext) are not exercised in tests; those are verified manually in
the running app.


## Release checklist

- [ ] Bump version in `package.json`
- [ ] `npm run typecheck` clean
- [ ] `npm test` green
- [ ] Build on Windows → install → record → transcribe
- [ ] Build on macOS (arm64 + x64) → install → record → transcribe
- [ ] Verify transcript format unchanged against Cowork plugin
- [ ] Publish artifacts as GitHub release
