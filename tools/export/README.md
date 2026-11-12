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
python3 tools/export/export_palette.py --game-repo ../Cosmic-Shore          # write the colour sets
python3 tools/export/export_palette.py --game-repo ../Cosmic-Shore --check  # exit 1 on drift
```

Plain Python 3. Writes every unlocked set of the game's `ColorSetCatalog` into `src/palette.ts` (the settings'
**Colours** choice) and the list of them into `host/windows/src/colour_sets.h` (and
`host/macos/Sources/ColourSets.swift` once that host exists). Each set carries its four domain blocks and its
**traced** colours for the materials the screensaver copies (sky, nucleus cage, membrane, crystal and its effects):
the game repaints every material colour from the worn set by the colour trace (`Docs/VesselModels/COLOR_TRACE.md`
there), and the exporter does that lookup offline, so the page only picks a table. The default is the set the game
paints with (the `ColorSet` field of `ThemeManagerDataContainer.asset`; Nocturne since 2026-11-03), read from the
field, not a file name. A material colour the screensaver starts drawing from a new material is added to
`MATERIALS` in the exporter. See `parity/PARITY.md` for when to run it.

## Sky

```bash
python3 tools/export/export_skybox.py --game-repo ../Cosmic-Shore          # write src/sky_shader.ts
python3 tools/export/export_skybox.py --game-repo ../Cosmic-Shore --check  # exit 1 on drift
```

Plain Python 3. Translates the CGINCLUDE block of `HyperSeaSkybox.shader` (HLSL) into GLSL and takes the numbers
from `Assets/_Graphics/Skyboxes/HyperSeaSkybox.mat`, the material Menu_Main paints with; colours are converted to
linear as the game's linear colour space does.

## The crystal's effects (Mass triangles and Charge arcs)

```bash
python3 tools/export/export_crystal_fx.py --game-repo ../Cosmic-Shore          # write crystal_prisms.json, src/crystal_fx_data.ts
python3 tools/export/export_crystal_fx.py --game-repo ../Cosmic-Shore --check  # exit 1 on drift
```

Plain Python 3. Reads the 20-prism mesh `OmniCrystalTriangles.asset` (mapped into the body's axes by matching its plates
against crystal.glb's own six-corner plates), the depth-prism material and profile, the charge-arc material and profile
and the crystal cadence. The motion rules (DepthRatchet, ChargeArcs) are hand-ported in `src/crystal_fx.ts`.

## Vessels, fauna, the crystal and the nucleus

The same script exports any FBX: `--name crystal --fbx Assets/_Models/OmniCrystalExport1_8-21-25.fbx --no-anim`
and `--name nucleus --fbx Assets/_Models/Node2.fbx --no-anim`.

Needs Blender's Python module (`pip install bpy`; M0 used Blender 5.2.3 LTS on Python 3.13):

```bash
python3 -m venv .bpy && .bpy/bin/pip install bpy
.bpy/bin/python tools/export/export_vessel.py --game-repo ../Cosmic-Shore --name squirrel \
    --fbx "Assets/_Models/Vessel Models/SquirrelVessel_CosmicShoresTest1.fbx"
```

Planned next (M3): `manta` (`Manta_shapekey_rigged.fbx`), `serpent` (`SerpentExport.fbx`), and the fauna
`mediumfish.fbx` and `Shark_model.fbx`. Mesh compression (meshopt via gltfpack) arrives with them.
