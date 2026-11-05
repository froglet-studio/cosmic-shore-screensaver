# Keeping the screensaver in step with the game

The screensaver copies the look of the game's Home screen (the lava lamp). The game keeps changing that look:
on 2026-11-03 Garrett made **Nocturne** the default colour set ("every prism a lantern: a glowing rim over a deep
jewel face"), which repainted every prism, hull and trail in the game a day after this repo's plan was measured.
Nothing in this repo noticed. This folder is how it notices from now on.

The screensaver never reads the game at runtime. Parity is an **offline, one-way** step a person or a Claude session
runs: game repo → exporters → files committed here → a new release.

## The pieces

| File | What it does |
|---|---|
| `parity/sources.json` | Every Home screen piece the screensaver copies (palette, Garland, prism look, sky, bloom, camera, crystal, vessels, flora, fauna), the game paths it comes from, the screensaver files it feeds, how to sync it, and **`synced_at`**: the game commit it was last brought over from. |
| `tools/parity/check.py` | Lists, per piece, the game commits that touched its game paths since `synced_at`, flags game paths that were renamed or moved, and checks two pieces by value: the palette and the Garland generator. Exits 1 when anything needs attention. |
| `tools/export/export_palette.py` | Writes `src/palette.ts` from the colour set the game **actually paints with** (the one `ThemeManagerDataContainer.asset` names), so the next default switch is one command. `--check` is its drift gate; `--set photic` (or `dartfrog`, any `ColorSetCatalog` id) tries another set. |

## When to run it

1. **At the start of any visual work** in this repo, so you build against today's game.
2. **At every milestone** (plan §6), before the milestone's PR.
3. **Before every release** (the ship gate): against the latest `bleeding-edge`, the report must say "Needs attention
   (0)". The release workflow, when it exists, runs the check and refuses to publish otherwise.

## The procedure

```bash
git -C ../Cosmic-Shore fetch origin bleeding-edge && git -C ../Cosmic-Shore checkout origin/bleeding-edge
python3 tools/parity/check.py --game-repo ../Cosmic-Shore
```

For each piece under **Needs attention**:

- **Read the listed commits**, starting with the game's docs (`Docs/PALETTE.md`, `Docs/VesselModels/COLOR.md`,
  `Docs/claude/MENU_AND_LAVA_LAMP.md`, the hull's `Docs/VesselModels/<Hull>.md`). Most commits that touch a file do
  not change what shows on the Home screen; say which ones do.
- **If it changes the look, sync it** with the piece's `sync` command (exporters) or a hand port (shaders, numbers).
  Compare against a Unity still of the Home screen when the change is subtle.
- **If a path is missing**, the game renamed or moved it (the colour set `OriginalColorSetSO` became
  `PhoticColorSetSO` on 2026-11-03). Fix `sources.json` and the exporter that reads it.
- **Then mark it synced**, only once the screensaver matches:
  `python3 tools/parity/check.py --game-repo ../Cosmic-Shore --mark-synced palette,camera`

Commit the synced files together with `sources.json`, and say in the PR which game commits they follow.

A piece that is **not built yet** has no `synced_at`. When its milestone builds it, export it from the game's
current `bleeding-edge` and mark it synced in the same PR.

## What it cannot see

- **Changes outside the listed paths.** If the game moves the Home screen to a new scene, a new world or a new
  palette mechanism, nothing listed here changes. Re-read `Docs/claude/MENU_AND_LAVA_LAMP.md` at each milestone and
  add new paths to `sources.json` when the Home screen grows a new piece.
- **Whether a hand port still looks right.** Shaders are re-authored for the web, so only a side-by-side with a
  Unity capture shows that (plan M2).

## Updates for people who already installed it

The screensaver makes no network calls (plan principle 3), so it never updates itself. People get a new look by
installing a new release from the landing page. If periodic updates become wanted, the cheap honest version is a
"check for updates" link in the settings dialog that opens the landing page in the browser; the screensaver itself
still sends nothing.
