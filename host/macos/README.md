# The macOS host (`CosmicShore.saver`)

Milestone M7 of `docs/PHASE1_ASSESSMENT_AND_PLAN.md` (§8.2). A Swift `ScreenSaverView` (`Sources/`, no
Xcode project, no nib) that shows the web scene in a `WKWebView`. The page is the same file the Windows
`.scr` embeds (`npm run build:host` → `dist-single/screensaver-host.html`), copied into the bundle's
Resources and served by the host itself from a private `cosmicshore://` scheme. Nothing else is served,
navigation anywhere else is refused, the page's CSP allows only itself, and the web view keeps no data on
disk. It makes no network request.

| macOS does | What happens |
|---|---|
| Starts the screensaver | One view per screen (each with its own page: nothing shared), at the chosen frame rate. "Main screen only" leaves the others black. |
| Ends it (any input) | The system ends it; the web view never takes the mouse or the keyboard, so input reaches the system as with any screensaver. On `com.apple.screensaver.willstop` the full-screen process exits (`exit(0)`), so old views cannot pile up. |
| Shows the thumbnail in System Settings | The preview: half resolution, 15 fps. It ignores `willstop` (that process outlives each run). |
| **Options…** | A sheet with the Windows dialog's three choices: frame rate (30 / 60), every screen or the main one, wide or close-up camera. Saved with `ScreenSaverDefaults` (module `games.froglet.cosmicshore.saver`). |
| Displays sleep | The web views are hidden, so the pages stop drawing; shown again on wake. |

A crashed page reloads. The log is the unified log (`log stream --predicate 'subsystem ==
"games.froglet.cosmicshore.saver"'`); setting `COSMICSHORE_SAVER_LOG=<file>` also writes a file (the smoke
test reads it, the real `legacyScreenSaver` never has it).

**The `legacyScreenSaver` workarounds** (from AerialScreensaver/ScreenSaverMinimal, plan §8.2), all in
`Sources/CosmicShoreView.swift`: exit on `willstop`; treat a frame narrower than 400 pt as the preview
(Tahoe misreports `isPreview`); ignore `animateOneFrame` (the page keeps its own clock); look up the bundle
with `Bundle(for:)`, never `Bundle.main` (that is `legacyScreenSaver`).

## Build

On a Mac with Node 22 and the Xcode command line tools (`xcode-select --install`):

```bash
npm ci
host/macos/build.sh 0.1.0       # → dist-macos/CosmicShore.saver, the zip, SHA256SUMS.txt, SIGNING
host/macos/smoke.sh dist-macos/CosmicShore.saver
open dist-macos/CosmicShore.saver   # installs it
```

The binary is universal (arm64 + x86_64), built by `swiftc` for macOS 12 and later.

## Test

`smoke.sh` (CI job `macos` on `macos-latest`, every PR) loads the bundle the way the system does with a
small stand-in host (`smoke/Harness.swift`, never shipped) and checks: the signature verifies; the Options
sheet builds; full screen and preview each draw the scene (a snapshot that is not black); the page asks
for nothing outside itself and reports no error; `willstop` ends the full-screen process with exit 0 and
leaves the preview running. Its pictures are the `macos-smoke` artifact, and `print_shots.sh` writes them
into the job log as base64 JPEGs.

What CI cannot test, and needs a real Mac by hand (plan §7.2): installing from a download (Gatekeeper),
the real `legacyScreenSaver` on Sonoma / Sequoia / Tahoe, two displays, sleep and wake, the 8 h soak, and
the System Settings thumbnail.

## Release and signing

`release.yml` builds this beside the Windows zip and publishes both in one GitHub Release. Signing is
`sign.sh`: ad-hoc until the Developer ID secrets exist in the `release` environment, then Developer ID +
hardened runtime + notarization + stapling. Setting it up is configuration only: **`SIGNING.md`**.
