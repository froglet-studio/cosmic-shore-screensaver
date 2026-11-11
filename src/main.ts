import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { loadGarland } from './garland';
import { loadVessel } from './vessel';
import { Sky } from './sky';
import { GamePostPass } from './post';
import { loadNucleus, makeMembrane } from './shell';
import { DOMAINS, JADE, WORN, chooseInPreview } from './colours';
import { COLOUR_SETS } from './palette';
import { Rng } from './rng';
import { Crystal, CRYSTAL_HIT_RADIUS } from './crystal';
import { Pilot } from './pilot';
import { Trail } from './trail';
import { attachHost, hostReady } from './host';

// ── settings (URL params; the colour set is read by src/colours.ts) ───────────────────────
const params = new URLSearchParams(location.search);
const FPS_CAP = Number(params.get('fps') ?? 30);
const DEBUG = params.has('debug');
const SEED = Number(params.get('seed') ?? 0x5eed) >>> 0;
// Render scale (0.25-1): the Windows preview thumbnail asks for 0.5.
const SCALE = Math.min(Math.max(Number(params.get('scale') ?? 1) || 1, 0.25), 1);
attachHost(params);
// The ring size of the trail (the plan's D4). Two rails, so this is ~107 s of flight at 36 u/s.
const TRAIL_CAPACITY = 1500;
let view: 'lavalamp' | 'vessel' = params.get('view') === 'vessel' ? 'vessel' : 'lavalamp';

// ── renderer ──────────────────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * SCALE);
renderer.setSize(innerWidth, innerHeight);
// The game renders HDR in linear space with no tonemapping (URP_Asset: colour grading LDR, no Tonemapping
// override in the profile), so values above 1 clip at the output, as they do in the game.
renderer.toneMapping = THREE.NoToneMapping;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Menu_Main's camera: FOV 60, far plane 8,000.
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 8000);
scene.add(camera);
scene.add(new THREE.AmbientLight(0x6070a0, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(1, 0.6, 0.3);
scene.add(sun);

const sky = new Sky();
sky.bakeAll(renderer, 0);
scene.background = sky.texture;

// The cell's shell: the nucleus cage and the capsule membrane (src/shell.ts)
const membrane = makeMembrane();
scene.add(membrane);

// ── post: the game's profile (URP bloom + Panini, src/post.ts), then linear -> sRGB ─────────
// URP_Asset renders with 4x MSAA at render scale 1. The composer draws the scene into its own target, where the
// canvas's antialias flag does not reach, so the target carries the samples itself (WebGL2 multisampling).
const sceneTarget = new THREE.WebGLRenderTarget(
  innerWidth * renderer.getPixelRatio(),
  innerHeight * renderer.getPixelRatio(),
  { type: THREE.HalfFloatType, samples: 4 },
);
const composer = new EffectComposer(renderer, sceneTarget);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new GamePostPass(camera));
composer.addPass(new OutputPass());

// ── content ───────────────────────────────────────────────────────────────────────────────
const [garland, vessel, nucleus] = await Promise.all([
  loadGarland(),
  loadVessel('squirrel.glb', DOMAINS[JADE]),
  loadNucleus(),
]);
scene.add(nucleus);
scene.add(garland);

const rng = new Rng(SEED);
const crystal = new Crystal(rng);
await crystal.load();
scene.add(crystal.object);
if (params.has('debug')) Object.assign(window, { __crystal: crystal, __camera: camera });

// The exported GLB already has its nose on +z (the Squirrel dossier: nose +1.89, tail tip -4.56),
// the same as the pilot's frame, so the model needs no turn.
// The LavaLamp camera (MenuCam_LavaLamp1.asset): orbit radius 686 at 2.83 deg/s about (1,1,0),
// starting at Unity (0,0,-1) = three (0,0,1), 30 units of height offset. Its position follows with
// SmoothDamp (0.3 s) and its look turns toward the crystal at rotationSharpness 0.45, which is why the
// shot drifts slowly after each relocation.
const LL_AXIS = new THREE.Vector3(1, 1, 0).normalize();
const LL_START = new THREE.Vector3(0, 0, 1);
const LL_RADIUS = 686;
const LL_DEG_PER_S = 2.83;
const LL_LOOK_SHARPNESS = 0.45;

// The vessel starts inside the camera's orbit, heading in toward the cell.
const pilot = new Pilot(vessel, LL_START.clone().multiplyScalar(LL_RADIUS - 120).add(new THREE.Vector3(0, 30, 0)), new THREE.Vector3(0, 0, 0));
scene.add(pilot.object);
if (params.has('arrow')) pilot.object.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 12, 0xff3030));
const trail = new Trail(TRAIL_CAPACITY, DOMAINS[JADE]);
scene.add(trail.mesh);
let collected = 0;

const tmp = new THREE.Vector3();
const lookQ = new THREE.Quaternion();
const lookM = new THREE.Matrix4();
const chaseOffset = new THREE.Vector3();
let cameraPlaced = false;
function lookTowards(target: THREE.Vector3, sharpness: number, dt: number) {
  lookM.lookAt(camera.position, target, camera.up);
  lookQ.setFromRotationMatrix(lookM);
  if (!cameraPlaced || sharpness <= 0) camera.quaternion.copy(lookQ);
  else camera.quaternion.slerp(lookQ, 1 - Math.exp(-sharpness * dt));
}
function poseCamera(t: number, dt: number) {
  const look = params.get('look');
  if (look) {
    // debug: from the cell centre, look along a direction given in Unity's frame (x,y,z), e.g. the sky's core
    const [x, y, z] = look.split(',').map(Number);
    camera.position.set(0, 0, 0);
    lookTowards(tmp.set(x, y, -z), 0, dt);
  } else if (params.has('crystalcam')) {
    // debug: a close orbit of the crystal
    const a = THREE.MathUtils.degToRad(10 * t);
    const r = Number(params.get('crystalcam')) || 30;
    camera.position.set(crystal.position.x + Math.cos(a) * r, crystal.position.y + r * 0.27, crystal.position.z + Math.sin(a) * r);
    lookTowards(crystal.position, 0, dt);
  } else if (view === 'lavalamp') {
    tmp.copy(LL_START).applyAxisAngle(LL_AXIS, THREE.MathUtils.degToRad(LL_DEG_PER_S * t)).multiplyScalar(LL_RADIUS);
    camera.position.set(tmp.x, tmp.y + 30, tmp.z);
    lookTowards(crystal.position, LL_LOOK_SHARPNESS, dt);
  } else {
    // Close-up: a slow orbit around the flying vessel, a little behind and above it.
    const a = THREE.MathUtils.degToRad(6 * t);
    chaseOffset.set(Math.cos(a) * 24, 8, Math.sin(a) * 24);
    if (params.has('side')) chaseOffset.set(0, 18, 0).applyQuaternion(pilot.object.quaternion);
    tmp.copy(pilot.position).add(chaseOffset);
    if (!cameraPlaced) camera.position.copy(tmp);
    else camera.position.lerp(tmp, 1 - Math.exp(-6 * dt));
    lookTowards(pilot.position, 0, dt);
  }
  cameraPlaced = true;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
function toggleView() {
  view = view === 'vessel' ? 'lavalamp' : 'vessel';
  cameraPlaced = false;
  if (viewBtn) viewBtn.textContent = view === 'vessel' ? 'Wide view' : 'Close-up';
}
addEventListener('keydown', (e) => {
  if (e.key === 'v') toggleView();
});

// Preview controls: only in the shareable preview page (window.__PREVIEW), never in the screensaver.
let viewBtn: HTMLButtonElement | null = null;
if ((window as unknown as { __PREVIEW?: boolean }).__PREVIEW) {
  const bar = document.createElement('div');
  bar.id = 'controls';
  const mk = (label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return b;
  };
  // The game's colour sets: the choice is remembered in this browser and the page starts again in it.
  const colours = document.createElement('select');
  colours.setAttribute('aria-label', 'Colour set');
  colours.title = 'Colour set';
  for (const set of COLOUR_SETS) {
    const o = document.createElement('option');
    o.value = set.id;
    o.textContent = set.label;
    o.title = set.line;
    o.selected = set.id === WORN.id;
    colours.appendChild(o);
  }
  colours.addEventListener('change', () => chooseInPreview(colours.value));
  // keep 'v' from switching the view while the menu has the keyboard
  colours.addEventListener('keydown', (e) => e.stopPropagation());
  bar.appendChild(colours);
  viewBtn = mk(view === 'vessel' ? 'Wide view' : 'Close-up', toggleView);
  mk('Full screen', () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  });
  document.body.appendChild(bar);
}

// ── loop: capped frame rate; the browser already stops rAF on hidden pages ─────────────────
const hud = document.getElementById('hud')!;
const clock = new THREE.Clock();
let last = -1;
let frames = 0;
let crystalMs = 0;
const drawSize = new THREE.Vector2();
let fpsT = 0;
const minDt = 1 / FPS_CAP;
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  if (last >= 0 && t - last < minDt * 0.95) return;
  const dt = last < 0 ? 0 : t - last;
  last = t;
  const step = Math.min(dt, 0.25);
  pilot.update(step, crystal.position);
  if (pilot.position.distanceTo(crystal.position) < CRYSTAL_HIT_RADIUS) {
    crystal.relocate();
    collected++;
  }
  trail.update(t, pilot.position, pilot.object.quaternion);
  poseCamera(t, step);
  const c0 = performance.now();
  crystal.update(step, camera, renderer.getDrawingBufferSize(drawSize).y);
  crystalMs += performance.now() - c0;
  renderer.info.reset();
  sky.update(renderer, t);
  (membrane.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
  composer.render(dt);
  frames++;
  if (DEBUG && t - fpsT >= 1) {
    hud.textContent = `${frames} fps · ${garland.count + trail.mesh.count} prisms · ${collected} crystals · ${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} tris · crystal ${(crystalMs / Math.max(frames, 1)).toFixed(1)} ms`;
    crystalMs = 0;
    frames = 0;
    fpsT = t;
  }
});
(window as unknown as { __ready: boolean }).__ready = true;
hostReady();
