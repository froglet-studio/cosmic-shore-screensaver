# The Windows host (`CosmicShore.scr`)

Milestone M5 of `docs/PHASE1_ASSESSMENT_AND_PLAN.md` (§8.1). A small Win32 program (`src/main.cpp`, no
frameworks) that shows the web scene in Microsoft Edge WebView2, one per monitor, on one shared browser
process. The page (`npm run build:host` → `dist-single/screensaver-host.html`) is compiled into the
`.scr` as a resource and served from a made-up origin by the host itself, so the `.scr` is one file and
makes no network request: every other request is refused (403) and the page's CSP allows only itself.

| Windows asks | What happens |
|---|---|
| `/s` | A borderless topmost window per monitor; the cursor hides. Any key, click, wheel, touch or a mouse move over 8 px exits (raw input, a cursor check and the page's own events; input in the first 0.75 s is ignored). A display change also exits. |
| `/p <HWND>` (or `/p:<HWND>`) | A child of the Screen Saver Settings thumbnail at half resolution and 15 fps; exits when that window goes away. Input does not exit it. |
| `/c[:<HWND>]` or no argument | The settings dialog: frame rate (30 / 60), every screen or the main one only, wide or close-up camera. Saved to `%APPDATA%\Froglet\CosmicShoreScreensaver\settings.json`; a missing or corrupt file means the defaults. |
| `/w` | Ours, for testing: a normal 1280×720 window. |

Other behaviour: when the displays switch off the web views are hidden so the page stops drawing; a
crashed page reloads; WebView2's data folder is `%LOCALAPPDATA%\Froglet\CosmicShoreScreensaver\WebView2`
(the `.scr` may live in `System32`, which is read-only); background networking and SmartScreen URL checks
are off. Without the WebView2 Runtime it offers Microsoft's download page instead of failing silently.
Setting `COSMICSHORE_SCR_LOG=<file>` writes a log (the smoke test reads it).

## Build

On Windows with Node 22, CMake and the Visual Studio 2022 C++ build tools:

```powershell
npm ci
pwsh host/windows/build.ps1 -Version 0.1.0     # → dist-windows/CosmicShore.scr, the zip, SHA256SUMS.txt
pwsh host/windows/smoke.ps1 -Scr dist-windows/CosmicShore.scr
```

The `.scr` links the static CRT and the static WebView2 loader, so nothing ships beside it. On Linux,
`cmake -DCMAKE_TOOLCHAIN_FILE=<mingw toolchain>` compiles and links it as a check only (that build needs
`WebView2Loader.dll` beside it and is never shipped).

## Release

CI (`.github/workflows/ci.yml`, job `windows`) builds the zip and runs `smoke.ps1` on `windows-latest` for
every PR; the screenshots are the `windows-smoke` artifact. Pushing a tag `v*` runs `release.yml`, which
does the same and publishes a GitHub pre-release with the zip and `SHA256SUMS.txt`.

**Signing** (M6) is one step, `sign.ps1`, already in the build. Until the `release` environment has the
Azure Artifact Signing settings it logs "unsigned build" and passes; adding them is configuration, not a
code change.
