# Cosmic Shore Screensaver

A standalone, lightweight screensaver of the Cosmic Shore Home screen: vessels chasing the Omni crystal
through the Garland garden. It runs with no game, no Unity, no account and no network.

- **Plan:** [docs/PHASE1_ASSESSMENT_AND_PLAN.md](docs/PHASE1_ASSESSMENT_AND_PLAN.md)
- **Status:** M1. The Squirrel flies the game's AI steering law after the Omni crystal, lays its two-rail
  prism trail into a fixed ring, and the LavaLamp camera orbits the Garland (4,259 prisms from the game's own
  generator) aimed at the crystal.

## See it without installing anything

A live preview is published as a claude.ai page: https://claude.ai/artifact/3ybP8FmuapZ4mf1D9XT1c2
(private to Froglet until it is shared from the page's Share menu).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173  (?view=vessel close-up, ?debug stats, ?fps=60, ?seed=N)
npm run build        # dist/ is the whole bundle; it runs from any folder
npm run build:single # one self-contained HTML file in dist-single/ (the preview page)
npm run smoke        # headless Chromium: fails on console errors or any external request; screenshots in smoke-out/
```

Press `V` to switch between the LavaLamp view and the vessel close-up.

## Layout

| Path | What |
|---|---|
| `src/` | the renderer (three.js, TypeScript) |
| `public/content/` | exported content (generated, committed) |
| `tools/export/` | exporters that read a local game checkout |
| `tools/smoke.mjs` | the headless smoke test CI runs |
| `tools/look.mjs` | timed screenshots of a running scene, for checking motion |
| `docs/` | the plan |
