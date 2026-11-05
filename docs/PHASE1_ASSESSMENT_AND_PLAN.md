# Cosmic Shore Screensaver: Phase 1 assessment and plan

Written 2026-11-02. It was measured against the game repo `froglet-studio/Cosmic-Shore` at `bleeding-edge`
`4d906ea1`, and the landing page `froglet-studio/Cosmic-Shore-landing-page` at `main` `ae680d3`. The game
repo was only read; nothing in it was changed.

Every number here says where it came from. **Measured** means it was read from a file in the game repo.
**Estimate** means nobody has built it yet; the milestone that measures it is named.

---

## 0. The short answer

**Recommended path: option C.** Build one small web renderer (three.js, WebGL2) of the Home view. Run
that same bundle everywhere:

- the landing page (the live preview *is* the product);
- a thin native `.scr` host on Windows (WebView2);
- a thin `.saver` host on macOS (WKWebView);
- a browser tab on Linux.

The game repo feeds it through a **one-way, offline export** (meshes to glTF, prism layouts to binary). At
runtime nothing reads the game repo.

Why, in one paragraph: the Home view is almost entirely **instanced boxes** (prisms), plus a procedural
skybox, one crystal and one skinned vessel. That draws very cheaply in WebGL. A Unity build carries
40–100 MB of engine to draw it, and Unity has **no supported way to run inside a macOS `.saver`**. So
Unity would still need a web build *and* native shells, and we would pay for both. A web bundle of
roughly 2–5 MB (estimate, M2 measures it) in thin shells needs only one renderer, gives the smallest
download, and starts in under a second. The cost is fidelity: three of the game's shaders have to be
re-authored (§4.3). That risk is bounded, and M2 retires it with a side-by-side comparison against Unity
before any shell is built.

**"Runs without the game installed" is feasible on every target platform.** Nothing found blocks it.

Decisions I need from you are in §9.

---

## 1. The Home screen, as it is today

### 1.1 What is on screen

The Home view is the **lava lamp**: Menu_Main's freestyle world, with an AI flying the player's vessel
behind the menu UI (`Docs/claude/MENU_AND_LAVA_LAMP.md`).

| Element | What it is (measured) | Where |
|---|---|---|
| Scene | `Assets/_Scenes/Menu_Main.unity` (2.9 MB YAML). Post-processing comes from `Bootstrap.unity`, which persists. | |
| World ("cell") | One `Cell.prefab` with 14 configs and `cellTypeChoiceOptions = EnvironmentFree`. It **boots on Garland** (`BootDefault: 1`); the other 13 are opt-in through the Cell Selector toy. | `Cell.cs` `ResolveBootIndex` |
| Garland environment | `SpawnableGarland`: a deterministic, closed-form layout of **4,259 prisms**. It is a (2,3) torus-knot bough, a counter-wound vine, blossoms, leaf skirts, crown boughlets and 8 "falls", in three depth layers from radius 436 to 1,074. It was composed for this camera on purpose, and it is the main visual. | `Docs/ECOSYSTEM.md` §48 |
| Membrane | `CapsuleMembrane.prefab`, radius 1,200, spindle material | `SpindleGraph.shadergraph` |
| Nucleus | `Nucleus.prefab`, scale 400, cage material, control radius 392 | `CageGraph.shadergraph` |
| Cytoplasm | `SnowChanger.prefab`: drifting shards pointing at the crystal, drawn instanced | `SnowChanger.cs` |
| Cell modifier | `ExtraOmniCrystals.prefab` | |
| Flora | Garland profile: **Arbor** (floor 3, cap 5), **Tendril** (4/6), **Lantern** (4/7), **Spire** (2/3). All are `PhyllotacticFlora` that grow out of prisms and spindles. Plant count settles at 21. | `Garland Cell Spawn Profile.asset`, §48.4 |
| Fauna | **Brittlestar** (3/6), **QuadFish** (4/8), **Shark** (1/2). They appear after `InitialFaunaSpawnWaitTime: 20` s. | same |
| Mature size | ~**8,147 prisms**, 37 heart colliders | §48.4 |
| Vessel | **Squirrel** (`MainMenuController.menuVesselClass: 6`), domain 1, spawned through Netcode by `MenuServerPlayerVesselInitializer` and flown by `AIPilot`. It lays a prism trail **with no cap** (the conserved-mass rule). | `MENU_AND_LAVA_LAMP.md` |
| Crystal | `NetworkCrystalManager`: one Omni `Crystal.prefab` (`fixedCrystalCount: 1`, `anchorJitterRadius: 35`) that relocates when collected | Menu_Main |
| Camera | `MainMenuCameraController` is a plain transform rig with no Cinemachine. It starts on `MenuCam_LavaLamp1`: orbit radius **686**, **2.83°/s** about axis (1,1,0), aimed at the crystal, FOV 60, far plane 8,000. **Every 45 s** it glides to a random one of 5 configs (OrbitVessel, CinematicTrail, ChaseTight, TopDownPan, LavaLamp1). | `MenuCam_*.asset` |
| Skybox | `HyperSeaSkybox.mat` uses the hand-written `CosmicShore/HyperSeaSkybox` shader (773 lines of HLSL): a procedural galactic plane, stars, nebulae, a cell-overlay hex grid, a galactic core and an Andromeda disc. Ambient mode is skybox; there is no fog. | `_Graphics/Skyboxes` |
| Post | `GamePlay PostProcessing Profile`: **Bloom** (threshold 0.2, intensity 2.5, clamp 0.5) and **Panini projection** (distance 0.7). Vignette, white balance and DOF are present but inactive. The URP renderer has no renderer features. HDR is on. | Bootstrap → `PostProcessing.prefab` |
| Lighting | No baked lighting worth carrying; the look is emissive and colour-driven | |

### 1.2 How prisms are drawn in the game (important for every option)

Prisms render through **Entities Graphics** (BatchRendererGroup), with companion entities per prism
(`PrismRenderService.cs`). Animation is GPU-clocked (`Docs/PRISM_ANIMATION.md`). Entities Graphics needs
compute shaders. **On WebGL it is switched off**, and every prism falls back to its own MeshRenderer with
MaterialPropertyBlock stamps (`Docs/WEBGL_TOYBOX.md` §4). For a screensaver, both paths are overkill. A
static, baked layout of ~8k transforms is a single `InstancedMesh` (web) or a single
`Graphics.RenderMeshInstanced` call (Unity).

### 1.3 Shaders the Home view uses

| Shader | Kind | Size (measured) | Used for |
|---|---|---|---|
| `HyperSeaSkybox.shader` | hand HLSL | 773 lines | sky |
| `BlockGraph.shadergraph` | Shader Graph | 302 nodes, 14 custom-function nodes | every prism (environment, flora, trail) |
| `SpindleGraph.shadergraph` | Shader Graph | 167 nodes, 2 custom functions | flora limbs, membrane |
| `CageGraph.shadergraph` | Shader Graph | 103 nodes | nucleus |
| `CrystalGraph.shadergraph` | Shader Graph | 268 nodes | crystal |
| `OmniCrystalFresnelShader`, `OmniDepthPrismShader`, `CrystalChargeArcsShader` | hand HLSL | 197 / 208 / 124 lines | Omni crystal body, depth prisms, charge arcs |
| `VesselGraph.shadergraph` | Shader Graph | 78 nodes, 1 custom function | vessel hulls |

All of these are first party. None comes from the Asset Store.

### 1.4 What ties the Home view to the game (all of it is cut)

Every one of these goes. **Nothing is stubbed or ported**: the screensaver re-implements only "fly toward
the crystal" and "orbit the camera".

- **Networking:** Netcode for GameObjects 2.13.3, `MenuServerPlayerVesselInitializer`,
  `ClientPlayerVesselInitializer`, `NetworkCrystalManager`, `NetcodeHooks`, `ClientNetworkTransform`,
  `ArcadeConfigSyncManager`, and the in-memory or loopback host the menu boots.
- **Services and boot:** `Bootstrap` and `Authentication` scenes, `AppManager`, UGS (Auth, Cloud Save,
  Analytics, Friends, Lobby, Vivox, Leaderboards), PostHog, Steamworks, and the `ContainerScope` Reflex DI
  container.
- **Gameplay systems:** `VesselController` and its ~38 components per hull (actions, executors, impactors,
  HUD, elemental bars, resources, telemetry), `AIPilot`, and the Cell's ecology. The ecology is the food
  web, phase ladder, density grids and reproduction (`Cell.cs` alone is 3,807 lines).
  `PrismSpatialIndex`, Entities, physics triggers, and the SOAP event channels also go.
- **Menu and UI:** `ScreenSwitcher`, `MainMenuController`, `MenuCrystalClickHandler`, FTUE
  `QuestGraphRunner`, `ToyboxController`, `ModePreviewSession` and every UI prefab.
- **Audio:** FMOD (the product is silent; see §8 for leaving room for it).
- **Packages it pulls in:** Entities 1.4.2, Entities Graphics, NGO, Transport, Multiplayer Services, Vivox,
  Animation Rigging, VFX Graph, Cinemachine, AI Inference and Adaptive Performance. The screensaver needs
  none of them.

---

## 2. Candidate assessment

Costs are measured from the dossiers in `Docs/VesselModels/` and the prefabs. "Gameplay deps" means
scripts on the prefab; the screensaver drops all of them, so that column measures how much has to be
*thrown away*, not carried.

### 2.1 Vessels

| Vessel | Tris (measured) | Rig / anim | Materials | VFX | Gameplay scripts on prefab | Visual interest in motion |
|---|---|---|---|---|---|---|
| **Squirrel** | 13,660 (12,271 verts after split) | one skinned mesh; six floating wing slats per side; nine-rib chevron tail; artist takes (idle, pitch/yaw, speed) | 1 vessel material (`VesselGraph`) + trail prism | none | 38 | **High, and it is the Home vessel.** The slatted wings and segmented tail read well when banking. |
| **Manta** | 6,746 (lightest classic hull) | skinned, shape keys | ~11 material refs; collapses to body + domain + window | none | 32 | **High.** A glider silhouette that reads at distance, with slow and graceful banking. |
| **Serpent** | 8,572 | skinned; 20 chain/spike bones; four tendrils with tip bulbs | ~19 refs; collapses to 3 slots | none | 35 | **High.** The trailing tendrils give secondary motion for free (a spring chain or baked sway). |
| Dolphin | 25,118 (n-gons, 17 loose parts) | skinned + shape keys | 3 | none | 33 | Good, but the heaviest hull with messy topology |
| Sparrow | 25,984 (77 loose parts) | skinned, 65 bones | 0 direct | none | 43 | Spiky fans; the dossier records it flying backwards |
| Urchin | 11,824 | rig swap | 1 | none | 37 | Reads as a ball; little motion |
| Rhino | 16,798 | 12 bones | 17 | 2 particle systems | 38 | Bulky |
| Butterfly | not measured (912 KB FBX) | new model; flapping wings | | | prefab not authored yet (CLAUDE.md) | Potentially the most charming in motion. Worth measuring at M3. |

**Recommendation: Squirrel + Manta, with Serpent as the third.**

- **Squirrel** is not optional for fidelity: it is what the Home screen flies.
- **Manta** is the lightest hull in the classic fleet and has the most different silhouette.
- **Serpent** adds secondary motion (tendrils) at 8.6k tris.

All three have no particle or VFX dependencies, and all three are artist FBX files that the vessel-model
pipeline has already proven round-trip (`Docs/VesselModels/README.md`). Each vessel trails its own prism
wake in its domain colour, so three vessels plus three trails is the cheap way to get "busy but calm".

### 2.2 Flora (all prism-and-spindle growth; once baked, a plant is just instances)

| Species | Prisms per plant (measured budget) | Cost once baked | Visual note |
|---|---|---|---|
| **Arbor** | 312 | instances only | The hero silhouette, a ~280 u tree |
| **Tendril** | 144 | instances only | ~374 u of dangle: the best reach per prism in the fleet |
| **Lantern** | 84 | instances only | Blossom pods: colour near the camera |
| **Spire** | 204 | instances only | Tall thin verticals for rhythm |
| Branching / Coral / Frond / Reed / Rosette | similar | instances only | Not in Garland; possible variety later |
| Gyroid / SchwarzP / Quasicrystal / NestedGyroid | 1,000s per colony | heavy | Lattice species. Garland excludes them on purpose ("never grows to bonkers counts"). |
| Mandelbulb family | large | heavy | Not in the Home view |

**Recommendation: exactly Garland's four** (Arbor, Tendril, Lantern, Spire), baked at maturity (~21
plants). That is what the Home view shows. In the game, flora sways through `SpindleSway.hlsl` (a GPU
clock); the screensaver keeps a simplified vertex sway so the garden breathes.

### 2.3 Fauna

| Species | Construction (measured, `/fauna` skill) | Motion tier | Cost to carry | Visual note |
|---|---|---|---|---|
| **QuadFish** | one spindle over a `mediumfish.fbx` submesh (70 KB FBX) + 4 fin prisms | GPU sway + a small CPU swim driver | **Low** | "Swim strokes, motion at distance" |
| **Shark** | health prisms + 3 spindles + an FBX armature (`Shark_model.fbx`, 271 KB) | Animator + Animation Rigging + jaw driver | **Medium** (one baked swim clip in glTF; drop the rigging) | "The majestic slow pass" |
| Brittlestar | health prisms + 11 spindles + armature | Animator + `DampedTransform` arm chains | Medium–high (the dangling arms need a spring chain) | Lovely, but it costs the most to reproduce faithfully |
| Tadpole | one prism + crystal | flocking (`Boid`) | **Lowest** | Shoals; not in Garland |
| Clawfish, Worm colony, swarms, NCA creatures | various | various | high, or dependent on compute | out of scope |

**Recommendation: QuadFish + Shark.** Add a **Tadpole shoal** as the cheapest optional extra, and
consider Brittlestar later if the arms can be done with a simple spring chain. Fauna follow simple
wander/avoid steering. There is **no food web**: in the game, fauna eat prisms, which would make the
screensaver's layout change over hours, and we want it stable.

### 2.4 Environment

Keep: the Garland environment (4,259 prisms), nucleus, membrane, cytoplasm shards (thinned), the Omni
crystal (body, depth prisms and charge arcs), the HyperSea skybox, bloom and Panini. Drop: everything else.

---

## 3. Technology decision

### 3.1 The three options

| | **A. Unity standalone** | **B. Unity WebGL** | **C. Web-tech port (three.js)** |
|---|---|---|---|
| Fidelity | Highest: same shaders and assets, copied | High: same shaders; no Entities Graphics, no compute | Good, after re-authoring 3 shader families (§4.3) |
| Download | Estimate: 25–40 MB zipped Windows player (URP + IL2CPP, stripped). M1 of an A path would measure it. | Estimate: 8–15 MB Brotli for a minimal scene. The Toybox is far bigger, but it carries the whole game. | Estimate: **2–5 MB** total (three.js ~150 KB gz, 3 vessels + 2 fauna as Draco glTF, ~10k baked instances, shaders) |
| Startup | 1–3 s to first frame (estimate) | 3–8 s per activation: wasm compile, plus 256 MB initial heap (Toybox setting) | **< 1 s** (estimate) |
| Idle cost | Unity's player loop plus URP post; fine at a 30 fps cap, but there is a floor | wasm single-threaded at ~half native speed (`WEBGL_TOYBOX.md` §4) | Lowest: the browser throttles hidden or occluded views for free |
| Windows `.scr` | Natural: `-parentHWND` for preview (documented) | Needs a web-view host anyway | Needs a web-view host (WebView2, ships with Windows 11) |
| macOS `.saver` | **Not supported.** Unity as a Library is iOS/Android only, so there is no path into `legacyScreenSaver`. Only a separate "ambient" app works. | WKWebView host | WKWebView host |
| Landing-page preview | None | Yes, through the Toybox pipeline | Yes, and it is the same bundle |
| Linux / browser | Unity Linux player | URL | URL |
| Maintenance | A Unity project + a native launcher | A Unity project + 2 native web hosts | A web project + 2 native web hosts |
| Unity licence | Unity 6 Personal can turn the splash off | same | n/a |

### 3.2 "One Unity project producing A and B": realistic, but not the right goal

One Unity project with two build profiles is routine, and the Toybox already proves the WebGL half. But it
gives you **three** runtime surfaces to own: the Unity player, a WebView2 host for the B build where
wanted, and a WKWebView `.saver` for the Mac. All of them carry Unity's weight, and the Mac would still run
the B build inside a web view. Once the shells are web views anyway, a 2–5 MB web renderer beats a
10–15 MB Unity wasm in startup, memory and battery, and it is the same code on every platform. A + B
doubles the maintenance load for a fidelity gain that shows mostly up close. This screensaver lives at
686 units, where a 2.5-unit prism is a pixel (§48 of `ECOSYSTEM.md`).

### 3.3 Recommendation: C, with A as a named fallback

- **C** is the one renderer. It ships as the landing-page preview, inside a native `.scr`, and inside a
  native `.saver`.
- **The fallback trigger:** if the M2 side-by-side (§6) shows the port cannot reach "reads clearly as Home",
  stop and switch Windows to **A**. A Unity standalone with `-parentHWND` keeps the same content plan,
  because the export pipeline (§4) is shared. The Mac would then use the C build or wait.
- **Considered and set aside: Amoebius** (the team's own C# engine, `Port/`). It loads the real scenes, but
  it is Shombith's engine for the game's own future (`Docs/TOOLING_DECISIONS.md` §6) and it has no web
  target. It could still serve as a **one-off offline exporter** (§4.2) if Shombith agrees; it would never
  be a runtime dependency.

---

## 4. Content pipeline (one-way, offline, game repo → screensaver repo)

Nothing at runtime touches the game repo. Exports are committed to this repo as versioned artifacts, each
with a manifest naming the game commit it came from.

### 4.1 Meshes → glTF

Blender is already the team's FBX tool (`Tools/Build/vessel_model/`, which uses Blender as a Python
module). A script in this repo exports, from a pinned game commit:

- Squirrel, Manta, Serpent, `mediumfish`, `Shark_model` → glTF 2.0: skinned, with morph targets where the
  hull has them, the shipped takes as clips, and Draco or meshopt compression;
- the prism, crystal, spindle and cage meshes → glTF.

Materials are not exported. The screensaver's shaders rebuild them from the slot names (Body, Domain,
Engine, Window), the way `VesselGraph` keys them.

### 4.2 Prism layouts → binary instance buffers

- **Garland environment:** the game already compiles the shipped `SpawnableGarland.cs` against a shim and
  runs it offline (`Tools/Build/garland_harness/run.sh`, which writes `garland_measurements.json`). Extend
  a copy of that harness *in this repo* to dump all 4,259 transforms, domains and kinds, about 4,259 × 48
  bytes ≈ 200 KB raw. It is exact and deterministic (`Hash01` only, §48.6).
- **Mature flora (21 plants):** `PhyllotacticFlora` growth is not closed-form, so it is captured from a
  running editor. The plan is an export-only editor script that lives **in this repo**. You copy it into a
  local game checkout, play Menu_Main until the garden settles, run the script, and **do not commit it to
  the game repo**. If you would rather have it in the game repo under `FrogletTools/`, that is the "later,
  optional" game-repo change the brief allows. Alternative: Amoebius headless, if Shombith agrees.
- **Trails:** trails are not exported; they are generated live (§5).

### 4.3 Shaders re-authored for the web (the fidelity risk)

| Game shader | Port difficulty | Plan |
|---|---|---|
| `HyperSeaSkybox` (HLSL) | **Low.** Hand-written procedural math; a mechanical HLSL→GLSL port with the same 40-odd material values | Render it to a cubemap once at start (or on a slow timer for twinkle), so it costs nothing per frame |
| `BlockGraph` (prisms, 302 nodes) | **Medium–high** as a graph, **low** for what shows at 686 u | Domain colour, edge emission and fresnel, plus the grow-in clock. Match it against Unity captures, not node for node. |
| `SpindleGraph` (167 nodes) | Medium | Thin emissive limbs with sway |
| `CrystalGraph` + 3 Omni HLSL | Medium | Fresnel body, depth prisms and arcs: hand HLSL ports directly |
| `CageGraph` | Low–medium | Emissive wire cage |
| `VesselGraph` (78 nodes) | Low | Flat emissive panels per slot ("vaporwave: flat emissive panels, no texture detail", Squirrel dossier) |
| Bloom + Panini | Low | three.js `UnrealBloomPass` (threshold and intensity matched) and a small Panini pass |

The fidelity gate is in M2: a **reference capture set** (stills from the Unity editor, at the same camera
poses, of the same baked layout) is compared side by side with the web build. That is how "reads clearly
as Home" becomes something we can judge.

---

## 5. The screensaver itself (behaviour)

- **Vessels:** 1 to 3 (setting). Each flies the game's own AI steering law toward the crystal
  (`AIPilot.cs` feeding `VesselTransformer` with the hull's prefab numbers; see "As built in M1" below),
  with a bounded bank into the turn. When a vessel reaches the crystal, the crystal relocates, and every
  vessel retargets. There is no scoring and no input.
- **Trails:** each vessel lays prisms at the game's cadence into a **fixed ring buffer** (for example 1,500
  per vessel), recycling the oldest with the game's shrink-out. *This deliberately breaks the game's
  conserved-mass law.* That law is for gameplay, and an unbounded trail is unbounded memory in a product
  meant to run for days. See decision D4.
- **As built in M1** (read from the game, 2026-11-03; this corrects the guesses above):
  - *Crystal.* Menu_Main authors no anchor list, so `CrystalManager.GetAnchorlessSpawnPoint` puts the one
    crystal at a uniform random point inside a ball the size of the nucleus (radius 392) around the cell
    centre, at least 5 units from its last spot. The vessels therefore fly inside the nucleus; there is no
    nucleus avoidance. `Crystal.prefab` (scale 10, collider radius 1.2) is collected within 12 units.
  - *Pilot.* Full stick toward the target except within a hair of the nose
    (`asin(|c|² · 100 / min(d², 50))`, hard turn when the target is behind). The stick turns the commanded
    rotation at 120 °/s (Squirrel `PitchScaler`/`YawScaler`); the hull follows it at 1.5 per second (AI
    pilots keep the fleet nose lag), which is what makes the wide, overshooting loops. Speed eases to
    0.6 × 60 = 36 u/s. The game's continuous roll input is replaced by a bank of up to 38° on the model.
  - *Trail.* Two rails, a pair every 7 units of travel after a 2 s delay; each rail prism is
    0.75 × 0.75 × 5.5, 9.625 off the flight line (slab 20 wide minus the 18.5 gap). The ring holds 1,500
    prisms (about 107 s of flight); the oldest 80 shrink away as new ones are laid.
  - *Camera.* LavaLamp position on its orbit; the look turns toward the crystal at `rotationSharpness`
    0.45 (`MenuCam_LavaLamp1.asset`), so the shot drifts slowly after each relocation.
- **As built in M2** (ported from the game, 2026-11-05, game `15f1d3ae`):
  - *Colour.* The game renders HDR in linear space with **no tonemapping** (URP_Asset: LDR grading; no Tonemapping
    override), so the screensaver uses none either. Material colours are converted from gamma as Unity does.
  - *Sky.* `HyperSeaSkybox.shader` translated to GLSL by `tools/export/export_skybox.py`, baked into a 1024 cube
    map (as the game's own low-tier `StaticHyperSeaSkybox` does), one face re-baked per second.
  - *Post.* URP 17's bloom (threshold 0.2 → 0.033 linear, clamp 0.5, intensity 2.5, scatter 0.7, 4 mips at
    half res) and Panini projection (0.7, crop to fit), ported from `Bloom.shader` / `PaniniProjection.shader`.
  - *Prisms.* BlockGraph is Unlit: `lerp(Dark, rim, (1 − N·V)⁴)` with the rim dimmed 90% toward the base past
    ~316 units (`_SqrDistance` 100,000). There is no edge line: a far prism reads by its faces.
  - *Crystal.* The Omni body mesh with `OmniCrystalFresnelShader` (dark facing, lime silhouette, a lime shade per
    element plate). Its charge arcs and depth prisms are not ported yet.
  - *Shell.* The nucleus (`Node2.fbx`, CageGraph at 10% alpha) and the 2,562-capsule membrane (SpindleGraph's
    distance-faded Voronoi, which leaves the membrane nearly invisible from inside, as in the game).
- **Camera:** LavaLamp1 by default (686 u, 2.83°/s, aimed at the crystal), with slow glides to an orbit and
  a cinematic-trail framing every ~45 s, as the game does. TopDown and ChaseTight are probably too busy;
  we decide at M2.
- **Fauna:** wander and avoid inside the membrane band; QuadFish strokes; Shark plays one slow swim clip.
- **Determinism:** a seeded RNG, so a bug report can name a seed.

---

## 6. Milestones

Each milestone ends with something you can look at. Times are working estimates for one Claude session
plus your review.

| # | Milestone | Done when |
|---|---|---|
| **M0** | Repo scaffold, CI skeleton, export pipeline v0 (Squirrel glTF + Garland instance buffer) | `npm run dev` shows a static Garland and Squirrel model; CI builds the bundle |
| **M1** | **One vessel chasing a crystal on screen** (browser) | The Squirrel flies the steering law, the crystal relocates, the trail ring-buffers, the LavaLamp camera orbits |
| **M2** | **The Home look**: skybox, prism and spindle and crystal shaders, nucleus, membrane, bloom + Panini; reference captures from Unity | **Fidelity gate**: side-by-side stills reviewed by you. Pass → continue. Fail → §3.3 fallback. |
| **M3** | Content complete: Manta + Serpent, mature flora, QuadFish + Shark, cytoplasm, camera rotation, settings model | Meets the §7 budget in Chrome on a mid laptop; 8 h browser soak is flat |
| **M4** | **Landing-page live preview**: a `/screensaver` page with the preview, downloads ("coming soon") and FAQ | Merged on the landing page; preview loads in < 2 s on broadband |
| **M5** | **Windows `.scr`** (WebView2 host): `/s`, `/c`, `/p <HWND>`, multi-monitor, exit on input, settings, single-file `.scr` with embedded assets, zipped | Passes §7.2 on Windows 10 and 11; an **unsigned** release on GitHub Releases, linked from `/screensaver` with SmartScreen instructions |
| **M6** | Windows signing (Azure Artifact Signing) in CI | A signed release; SmartScreen reputation starts building (§8.1) |
| **M7a** | macOS `.saver` dev build (WKWebView host, ad-hoc signed) | Runs on Sonoma, Sequoia and Tahoe test Macs via the quarantine workaround (§8.2) |
| **M7b** | macOS public: Developer ID signing + notarization, **gated on Apple enrollment** | A notarized `.saver` in a `.zip` on Releases + landing page |
| **M8** | Linux/browser: a fullscreen URL (`/screensaver/play`) and an optional xscreensaver recipe; the in-game screensaver mode is separate (§8.5) | Docs page |

The ordering puts the web bundle first because every later milestone ships that same bundle. The preview
(M4) is ready before the first native binary.

---

## 7. Performance budget and test plan

### 7.1 Budget (targets; M3 and M5 measure against them)

| Item | Target |
|---|---|
| Web bundle (preview) | ≤ 5 MB transferred, cached immutably |
| Windows download | ≤ 8 MB `.zip` (single `.scr` + readme). WebView2 comes from the OS; it is not bundled (the fixed-version runtime alone is > 250 MB). |
| macOS download | ≤ 8 MB `.zip` |
| Frame rate | **30 fps cap by default** (setting: 30 / 60); render scale ≤ 1.0 with an automatic drop to 0.75 if frame time is over budget for 5 s |
| CPU | < 5 % of one core on a mid laptop (e.g. an i5/Ryzen 5 with iGPU) at 1080p30 |
| GPU | < 20 % utilisation on an integrated GPU at 1080p30; a battery/eco mode at 24 fps + 0.66 scale |
| Memory | Flat over 8 h: < 2 % growth after the first 10 min (all pools fixed size; no per-frame allocation in steady state) |
| Startup | First frame < 1 s after launch on an SSD (show the skybox immediately, grow the garden in, as the game does) |
| Draw calls | < 30 per frame (instancing for every prism, spindle and shard) |
| Network | **Zero** requests at runtime in `.scr` / `.saver` (assets embedded; CSP `default-src 'self'`) |

### 7.2 Test plan

- **Soak:** 8 h, then 72 h, on Windows and macOS, logging memory/CPU/GPU every minute (WebView2:
  `GetProcessInfos`; macOS: `ps`/`powermetrics`). Pass: the §7.1 memory rule, no fps decay.
- **Multi-monitor:** 2 and 3 displays, mixed DPI (100/150 %), mixed refresh rates, a portrait display,
  hot-unplugging a display while running. One instance per monitor sharing one browser process (Windows);
  per-screen `ScreenSaverView` instances (macOS, with the §8.2 workarounds).
- **Sleep/wake:** the screensaver → display sleep → wake; lid close and open; lock screen with "require
  password". Pass: no crash, no black screen, no CPU spinning while displays sleep (a page-visibility pause).
- **Preview pane:** Windows `/p` in Screen Saver Settings (opening and closing the dialog 50 times; the
  host must exit when the parent HWND dies). macOS System Settings thumbnail (known broken in Tahoe, §8.2,
  so the test is "no crash or leak").
- **Exit on input:** mouse move beyond a small threshold (ignore the first ~5 px of jitter), any key, mouse
  button, wheel, touch, gamepad button. It must exit within 100 ms and never leave a zombie process.
- **Settings `/c`:** round-trips to `%APPDATA%\Froglet\CosmicShoreScreensaver\settings.json`; a
  corrupt file falls back to defaults.
- **Installs:** right-click → Install; a double-click from Downloads (with mark-of-the-web); copying into
  `C:\Windows\System32` (installer later). Uninstall leaves nothing behind.
- **Browsers (preview):** Chrome, Edge, Firefox and Safari, current and previous versions; WebGL2 missing →
  a static poster image.
- **Automated in CI:** Playwright on headless Chromium. Boot, run 120 s, assert no console errors, fps ≥ the
  cap minus 10 % on the CI GPU path, the JS heap flat after warm-up, and zero network requests after load.
  The Windows host gets a smoke test on `windows-latest` (launch `/s` for 30 s, send input, assert exit
  code 0).

---

## 8. Platform integration (verified 2026-11-02)

### 8.1 Windows (`.scr`)

**The contract** ([Microsoft: Screen Saver command-line arguments](https://learn.microsoft.com/en-us/previous-versions/troubleshoot/windows/win32/screen-saver-command-line)):
no args = settings; `/c` = settings modal to the foreground window; `/p <HWND>` = preview as a child of
that window, covering its client area (HWND is an unsigned decimal); `/s` = run. Windows also passes forms
like `/c:1234` and `/P 1234`, so parse case-insensitively and accept `:` or a space.

**The host:** a native Win32 program (C++ with the static WebView2 loader, or Rust with `wry`), renamed
`.scr`, about 1–3 MB. Its parts:

- **Embedded content.** The web bundle is compiled into the `.scr` as a resource and served through
  `SetVirtualHostNameToFolderMapping` or `WebResourceRequested`. The `.scr` is a single file, works
  offline, and makes no file:// CORS trouble.
- **`/s`.** It enumerates monitors (`EnumDisplayMonitors`) and opens one topmost borderless window per
  monitor, each with its own WebView2 controller on **one shared environment** (one browser process). A
  setting chooses all screens or the primary only with the others black.
- **`/p`.** It makes a child window of the given HWND, uses a low-quality profile (small render scale,
  15 fps), and exits when `IsWindow(parent)` goes false.
- **Exit on input.** WebView2 swallows input, so the page forwards `pointermove`/`keydown` events through
  `postMessage`, and the host also checks raw input (`WM_INPUT`) as a backstop.
- **The WebView2 runtime** is part of Windows 11 and on "the vast majority" of Windows 10 devices
  ([Microsoft: WebView2 distribution](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)).
  If it is missing, the host shows a one-line message with Microsoft's bootstrapper link instead of failing
  silently.

If option A were chosen instead, the Unity player supports `-parentHWND <HWND> delayed` for embedding, plus
`-monitor N`, `-screen-fullscreen` and `-window-mode borderless`
([Unity: player command-line arguments](https://docs.unity.com/en-us/engine/6000.6/manual/unity-editor/command-line-arguments/player)).
A small launcher `.scr` would map `/p` and `/s` onto those.

**Installation:**

- Alpha: a `.zip` containing `CosmicShore.scr` + `README.txt`. You extract it, then right-click the `.scr`
  and choose **Install**, which opens Screen Saver Settings with it selected.
- Public: a small installer that copies the file to `%WINDIR%\System32` and sets it. It is per-machine and
  needs admin. We decide at M6.
- Never ship a bare `.scr` link.

**Unsigned behaviour:** files downloaded through a browser carry the mark of the web, and it carries into
extracted files. Running or installing the unsigned `.scr` shows SmartScreen's "Windows protected your PC".
The user clicks **More info → Run anyway**. Some antivirus engines flag unsigned `.scr` files
heuristically. Early releases must say this plainly, with screenshots, on `/screensaver`.

**Signing path: Azure Artifact Signing** (formerly Trusted Signing), **about $9.99/month**, available to
**organisations in the USA, Canada, the EU and the UK**, and to individuals in the USA and Canada only
([Microsoft: code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)).
Froglet Games, Inc. should qualify as a US organisation; the identity validation is the step to start
early. Microsoft is explicit that it "does **not** provide instant SmartScreen trust": reputation builds
with consecutive signed releases under one identity. **Adopt it at M6, before the public launch
announcement**, so reputation is building while traffic is still low. The CI pipeline has a no-op
`sign` step from M5 (§8.6), so adding it later means adding secrets, not restructuring.

### 8.2 macOS (`.saver`)

**The host:** a Swift `ScreenSaverView` subclass containing a `WKWebView` that loads the bundle from the
`.saver`'s Resources. WebGL works in WKWebView; `webviewscreensaver` is an existing open-source `.saver`
built this way ([liquidx/webviewscreensaver](https://github.com/liquidx/webviewscreensaver)).

**`legacyScreenSaver` known issues on Sonoma, Sequoia and Tahoe** (sources:
[AerialScreensaver/ScreenSaverMinimal](https://github.com/AerialScreensaver/ScreenSaverMinimal),
[Michael Tsai, 2025-12](https://mjtsai.com/blog/2025/12/10/how-to-make-a-macos-screen-saver/),
[Aerial #1396](https://github.com/JohnCoates/Aerial/issues/1396)):

- `stopAnimation` is effectively not called in normal use; instances are not destroyed and pile up; the
  host process may never exit and can spin CPU.
- **Workaround (the community standard):** listen for the `com.apple.screensaver.willstop` distributed
  notification and `exit(0)`. Also drive animation from our own timer (the web page's rAF), not
  `animateOneFrame`.
- **Tahoe (macOS 26):** `isPreview` and the frame are misreported ("no known workaround"), multi-monitor
  is "mostly broken in new ways", and the Options button can be unresponsive. Testing on 26.3 beta 1
  showed the bugs still present and the workarounds still working.
- **Design consequence:** start from ScreenSaverMinimal's workarounds. Treat each screen's instance as
  independent (no shared state). Keep the settings sheet minimal, and also expose settings in the web page
  itself (a key press when not in screensaver mode).

**Signing and notarization:** a public `.saver` must be Developer-ID signed and notarized (`notarytool`,
`stapler`), so that Gatekeeper lets it load. This needs the **Apple Developer Program, $99/yr**.

- As an **organisation**, Apple needs a D-U-N-S number registered to the legal entity. D&B takes up to
  **5 business days** to issue one (expediting does not shorten this), then Apple needs up to **2
  business days** to receive it. If you need to request a D-U-N-S, plan for about **1–3 weeks** before
  enrollment can even start, plus Apple's own review
  ([Apple: D-U-N-S](https://developer.apple.com/support/D-U-N-S/)).
- If Froglet already has a D-U-N-S, for example from an existing App Store account for the game's iOS
  build, this drops to Apple's review. **Check first:** the game repo has an `ios-testflight.yml`
  workflow, which suggests an Apple team may already exist (decision D5).

**An unsigned dev/test build on current macOS:** Sequoia removed the Control-click Gatekeeper bypass. A
tester must:

1. try to open or install the `.saver`, and dismiss the warning;
2. go to **System Settings → Privacy & Security** and click **Open Anyway**;
3. confirm with an admin password;

or instead run `xattr -dr com.apple.quarantine CosmicShore.saver` before installing
([Macworld](https://www.macworld.com/article/2457844/what-to-do-when-you-cant-open-an-app-you-just-installed-in-macos-sequoia.html)).
On Apple Silicon, code must be at least ad-hoc signed to load at all, so CI ad-hoc signs (`codesign -s -`)
even before enrollment. That is fine for the team and a few testers, and not acceptable for the public, so
the public macOS milestone (M7b) is **gated on enrollment**. *(Update 2026-11-03: Froglet Games already has an Apple Developer account, so this gate is met; signing goes through Shombith, §9.1.)*

**The fallback**, if `legacyScreenSaver` regresses further: a tiny signed "ambient mode" menu-bar app
that goes fullscreen after the user's idle time and exits on input. It is the same bundle in a WKWebView
window. It still needs Developer ID and notarization, so it does not avoid the enrollment gate.

### 8.3 Linux and browser

- **Cheapest:** a fullscreen page `www.froglet.games/screensaver/play` (the same bundle; the Fullscreen API
  and the Screen Wake Lock are optional). Any browser, Linux included, can use it as an ambient mode.
- **xscreensaver:** possible through a hack that launches a kiosk browser into the root window, but that is
  fragile across distros. Document it as a community recipe, not a supported build.

### 8.4 Hosting and distribution

- **The web preview bundle** (≤ 5 MB) can live on the existing R2 bucket next to the Toybox
  (`/screensaver/latest.json`, the same pattern as `_data/toybox.yml`), or be vendored into the landing
  site. GitHub Pages caps files at 100 MB, so either works. R2 keeps the website repo free of build
  output; that is my recommendation.
- **Binaries: GitHub Releases** on this repo (each asset must be under 2 GiB;
  [GitHub docs](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)).
  **This repo is currently private, and private-repo release assets are not publicly downloadable.**
  Either make this repo public, or publish releases to R2 under `/screensaver/releases/<version>/`
  (decision D2).
- **The landing page:** `_data/screensaver.yml` holds the version and per-OS URLs, read by a
  `/screensaver` page, in the same pattern as `_data/toybox.yml`. CI opens a PR to the landing page on each
  release.

### 8.5 The in-game screensaver mode (secondary)

This lives in the game repo, later, and does not share code with the standalone. In Menu_Main, after N
minutes of no input, fade the menu canvas groups out, as `MenuCrystalClickHandler` already does for
freestyle. Keep the LavaLamp camera, cap the frame rate, and restore everything on any input. It touches
Menu_Main and the menu (`MENU_AND_LAVA_LAMP.md`), so it is a separate thread with the menu's owners when
you want it.

### 8.6 CI and release pipeline (sketch)

```
push / PR ──► web: lint, typecheck, build (Vite), Playwright smoke + perf + no-network check
tag v*    ──► web bundle ─┬─► windows-latest: build host (MSVC), embed bundle ──► [sign: no-op until M6] ──► zip
                          ├─► macos-latest:   xcodebuild .saver, embed bundle ──► codesign -s - (ad-hoc)
                          │                                                     ──► [Developer ID + notarize: no-op until M7b] ──► zip
                          └─► publish: GitHub Release (or R2) + checksums + upload preview bundle to R2
                                     ──► open PR on landing page: _data/screensaver.yml version/URLs
```

Signing steps read their secrets from a protected `release` environment. While the secrets are absent, the
step logs "unsigned build" and passes, so adding signing is a configuration change.

---

## 9. Decisions

### 9.1 Decided (Caleb, 2026-11-03)

| # | Decision |
|---|---|
| **D1** | **Web (option C).** Froglet Games already has an Apple Developer account. That changes the macOS timeline, not the choice: the `.saver` host is a WKWebView either way, and Unity still has no path into a `.saver`. |
| **D2** | **This repo becomes public**, and downloads ship through GitHub Releases. |
| **D3** | **Content as recommended:** Squirrel, Manta and Serpent; Arbor, Tendril, Lantern and Spire; QuadFish and Shark. |
| **D5** | **Apple:** use Froglet Games' existing Apple Developer team. Its Developer ID certificate and notarization credentials come from Shombith, or the finished macOS build is handed to Shombith to sign and publish. So **M7b is no longer blocked on enrollment**; there is no D-U-N-S wait. **Windows:** Azure Artifact Signing is still to set up before M6. |

### 9.2 Still open

D4 (trail ring buffer), D6 (where the flora export script lives) and D7 (art provenance) from the table
below. D7 must be settled before the first public release.

### 9.3 The original table

| # | Decision | My recommendation |
|---|---|---|
| **D1** | Technology path | **C**: a three.js bundle + thin native hosts, with the M2 fidelity gate and A as a fallback for Windows |
| **D2** | Where downloads live | Make **this repo public** and use GitHub Releases (simplest, free, gives a public changelog). The alternative is R2 next to the Toybox. |
| **D3** | Content | Vessels **Squirrel + Manta + Serpent**; flora **Arbor, Tendril, Lantern, Spire**; fauna **QuadFish + Shark** (Tadpole shoal optional) |
| **D4** | Trails | Accept a **fixed-size trail ring buffer** in the screensaver only. It departs from the game's conserved-mass law, but the screensaver is not the game. |
| **D5** | Signing accounts | Start **Azure Artifact Signing** identity validation for Froglet Games, Inc. now; at about $10/month it can wait until M6. Check whether an **Apple Developer team already exists** for the iOS TestFlight build. If yes, M7b is unblocked; if no, request the D-U-N-S now, given the 1–3 week lead. |
| **D6** | Flora export | An export-only editor script kept in this repo and run in your local game checkout, **never committed to the game repo**. Or allow it into the game repo under `FrogletTools/`. |
| **D7** | Art provenance | Confirm that the vessel FBXs (Squirrel, Manta, Serpent) and fauna FBXs (`mediumfish.fbx`, `Shark_model.fbx`) are Froglet-owned or licensed for free redistribution. Their origin could not be read from the repo (shallow history). |

---

## 10. Risks and open questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The web port doesn't read as Home | Medium | High | M2 gate with reference captures; the A fallback keeps the content pipeline |
| macOS `legacyScreenSaver` breaks further (it already did in Sonoma and Tahoe) | High | Medium | ScreenSaverMinimal workarounds; an ambient-app fallback; macOS is second priority |
| SmartScreen / antivirus false positives on an unsigned `.scr` | High until signed | Medium | Clear instructions; sign at M6 before announcing |
| WebView2 missing on old Windows 10 | Low | Low | Detect it and link Microsoft's bootstrapper |
| Long-run memory growth in web views | Medium | High | Fixed pools, no per-frame allocation, 72 h soak, a nightly self-reload as a last resort |
| Flora snapshot drifts from the game | Low | Low | It is a snapshot by design; re-export when the Home view changes notably |
| Game art changes (vessel rebuilds are in flight in the game repo) | Medium | Low | Exports pin a game commit; re-export on purpose |
| Artist licence on FBXs | Unknown | High | D7 before the first public release |

**Third-party licences in the chosen content:**

- **Clean:** three.js (MIT), the WebView2 SDK (Microsoft's redistributable licence for the SDK; the runtime
  is the OS's), and the Swift and ScreenSaver frameworks.
- **Excluded on purpose:** Epic Toon FX and the other VFX packs (none is in the Home view), FMOD (no
  audio), TextMesh Pro fonts (no text in the screensaver; if text is ever needed, use an OFL font), and
  QuickScenePro (an editor tool).
- **Needs confirmation:** D7 above.

**Open questions:**

1. Should the screensaver ever show the Cosmic Shore logo or a "get the game" line? (I assume a small,
   optional corner mark, off by default.)
2. Do you want the camera's ChaseTight and TopDownPan framings at all, or only the calmer three?
3. Should the domain colour be fixed (Jade, as the menu flies) or cycle across the four domains over
   time?
