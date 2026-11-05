---
name: parity-check
description: Check whether the screensaver still matches the game's Home screen look (colours, Garland, prisms, sky, bloom, camera, crystal, vessels, flora, fauna) and bring over what changed. Use at the start of visual work, at each milestone, before a release, or when asked whether the screensaver is up to date with the game.
---

# Parity check: is the screensaver still the game's Home screen?

The full procedure and its reasons are in `parity/PARITY.md`. In short:

1. **Update the game checkout.** It sits beside this repo at `../Cosmic-Shore` (clone `froglet-studio/Cosmic-Shore`
   there if it is missing). `git -C ../Cosmic-Shore fetch origin bleeding-edge && git -C ../Cosmic-Shore checkout origin/bleeding-edge`.
   Never commit to it.
2. **Run the check.** `python3 tools/parity/check.py --game-repo ../Cosmic-Shore --out smoke-out/parity-report.md`
   (`smoke-out/` is ignored by git; summarise the report).
3. **Triage each piece under "Needs attention".** Read the listed game commits, docs first. Say for each whether it
   changes what shows on the Home screen. A rename or move ("Missing in the game repo") means fixing
   `parity/sources.json` and the exporter that reads the path.
4. **Sync what changed** with the piece's `sync` command from `parity/sources.json`. For a hand port (shaders, camera
   or bloom numbers), make the change and show a before/after screenshot (`npm run smoke` writes `smoke-out/`).
5. **Mark synced** only what now matches:
   `python3 tools/parity/check.py --game-repo ../Cosmic-Shore --mark-synced <id>,<id>`.
   Commit the synced files and `parity/sources.json` together, and name the game commits followed in the PR.
6. **Report** in plain words: what the game changed, what the screensaver now does, and what is left (with who in
   the game team owns it, from the commit authors). Before a release, the report must show "Needs attention (0)".

Do not run the game repo's `/reorient` here: it merges `bleeding-edge` into a game branch, which this repo never does.
