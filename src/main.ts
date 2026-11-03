import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { loadGarland } from './garland';
import { loadVessel } from './vessel';
import { makeSky } from './sky';
import { DOMAINS, JADE } from './palette';

// ── settings (URL params for now; a settings model arrives in M3) ─────────────────────────
const params = new URLSearchParams(location.search);
const FPS_CAP = Number(params.get('fps') ?? 30);
const DEBUG = params.has('debug');
let view: 'lavalamp' | 'vessel' = params.get('view') === 'vessel' ? 'vessel' : 'lavalamp';
const ASSETS = `${import.meta.env.BASE_URL}content/`;

// ── renderer ──────────────────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
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

const sky = makeSky();
sky.scale.setScalar(4000);
scene.add(sky);

// Nucleus stand-in: the game's cage sits at scale 400 with a control radius of 392.
const nucleus = new THREE.LineSegments(
  new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(380, 2)),
  new THREE.LineBasicMaterial({ color: new THREE.Color(0.05, 0.12, 0.35), transparent: true, opacity: 0.5 }),
);
scene.add(nucleus);

// ── post: the game's profile is Bloom (threshold 0.2, intensity 2.5) + Panini (0.7) ────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.55, 0.55);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ── content ───────────────────────────────────────────────────────────────────────────────
const [garland, vessel] = await Promise.all([
  loadGarland(ASSETS),
  loadVessel(`${ASSETS}squirrel.glb`, DOMAINS[JADE]),
]);
scene.add(garland);
scene.add(vessel);

// The LavaLamp camera (MenuCam_LavaLamp1.asset): orbit radius 686 at 2.83 deg/s about (1,1,0),
// starting at Unity (0,0,-1) = three (0,0,1), 30 units of height offset, aimed at the crystal.
// The crystal arrives in M1; until then the camera aims at the cell centre.
const LL_AXIS = new THREE.Vector3(1, 1, 0).normalize();
const LL_START = new THREE.Vector3(0, 0, 1);
const LL_RADIUS = 686;
const LL_DEG_PER_S = 2.83;

// Park the vessel on the camera's path, a little inside the orbit, so both views show it.
const parked = LL_START.clone().multiplyScalar(LL_RADIUS - 70).add(new THREE.Vector3(0, 30, 0));
vessel.position.copy(parked);
vessel.lookAt(new THREE.Vector3(200, 60, 300));

const tmp = new THREE.Vector3();
function poseCamera(t: number) {
  if (view === 'lavalamp') {
    tmp.copy(LL_START).applyAxisAngle(LL_AXIS, THREE.MathUtils.degToRad(LL_DEG_PER_S * t)).multiplyScalar(LL_RADIUS);
    camera.position.set(tmp.x, tmp.y + 30, tmp.z);
    camera.lookAt(0, 0, 0);
  } else {
    // MenuCam_OrbitVessel-style: radius 80 (scaled in for M0's parked vessel), 6 deg/s.
    const a = THREE.MathUtils.degToRad(6 * t);
    camera.position.set(parked.x + Math.cos(a) * 11, parked.y + 3.5, parked.z + Math.sin(a) * 11);
    camera.lookAt(parked);
  }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
addEventListener('keydown', (e) => {
  if (e.key === 'v') view = view === 'vessel' ? 'lavalamp' : 'vessel';
});

// ── loop: capped frame rate; the browser already stops rAF on hidden pages ─────────────────
const hud = document.getElementById('hud')!;
const clock = new THREE.Clock();
let last = -1;
let frames = 0;
let fpsT = 0;
const minDt = 1 / FPS_CAP;
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  if (last >= 0 && t - last < minDt * 0.95) return;
  const dt = last < 0 ? 0 : t - last;
  last = t;
  poseCamera(t);
  renderer.info.reset();
  composer.render(dt);
  frames++;
  if (DEBUG && t - fpsT >= 1) {
    hud.textContent = `${frames} fps · ${garland.count} prisms · ${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} tris`;
    frames = 0;
    fpsT = t;
  }
});
(window as unknown as { __ready: boolean }).__ready = true;
