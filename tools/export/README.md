# Exporters (game repo → this repo, offline, one way)

Nothing at runtime reads the game repo. These scripts read a local checkout of
`froglet-studio/Cosmic-Shore` and write into `public/content/`. Commit their output.

## Garland environment

```bash
python3 tools/export/export_garland.py --game-repo ../Cosmic-Shore
```

Plain Python 3. It runs the game repo's own generator model unchanged and refuses to export if the
model's prism count disagrees with the game's committed measurement of the shipped C#
(`Tools/Build/garland_measurements.json`).

## Palette

```bash
python3 tools/export/export_palette.py --game-repo ../Cosmic-Shore          # write src/palette.ts
python3 tools/export/export_palette.py --game-repo ../Cosmic-Shore --check  # exit 1 on drift
```

Plain Python 3. It reads the colour set the game paints with (the `ColorSet` field of
`ThemeManagerDataContainer.asset`; Nocturne since 2026-11-03), not a file name. `--set photic` or
`--set dartfrog` writes another set from the game's `ColorSetCatalog`. See `parity/PARITY.md` for when to run it.

## Vessels and fauna

Needs Blender's Python module (`pip install bpy`; M0 used Blender 5.2.3 LTS on Python 3.13):

```bash
python3 -m venv .bpy && .bpy/bin/pip install bpy
.bpy/bin/python tools/export/export_vessel.py --game-repo ../Cosmic-Shore --name squirrel \
    --fbx "Assets/_Models/Vessel Models/SquirrelVessel_CosmicShoresTest1.fbx"
```

Planned next (M3): `manta` (`Manta_shapekey_rigged.fbx`), `serpent` (`SerpentExport.fbx`), and the fauna
`mediumfish.fbx` and `Shark_model.fbx`. Mesh compression (meshopt via gltfpack) arrives with them.
