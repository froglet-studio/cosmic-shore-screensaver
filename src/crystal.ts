import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Rng } from './rng';
import { loadBytes } from './content';

/**
 * The Home screen's one Omni crystal.
 *
 * Placement follows the game's CrystalManager for an anchorless cell (Menu_Main authors no anchor
 * list): a uniform random point inside a ball the size of the nucleus around the cell centre
 * (GetAnchorlessSpawnPoint, radius = Cell.ExpectedNucleusWorldRadius), redrawn while it lands within
 * 5 units of the last spot (MIN_SQR_SPACE_BTWN_CURRENT_AND_LAST_SPAWN_POS = 25).
 * Crystal.prefab is scale 10 with a 1.2 sphere collider, so a vessel collects it within 12 units.
 */
export const CRYSTAL_SPAWN_RADIUS = 392;
export const CRYSTAL_HIT_RADIUS = 12;

/** OmniCrystalBody.mat on OmniCrystalFresnelShader (gamma colours, converted to linear as Unity does). */
const lin = (r: number, g: number, b: number) => new THREE.Color(r, g, b).convertSRGBToLinear();
const OMNI = {
  bright: lin(0.4862745, 0.9882354, 0),
  dark: lin(0.0055484856, 0.006289184, 0.0044103395),
  // _ElementShades 1: each plate wears its element's shade of lime (CrystalElementPlates)
  charge: lin(0.18, 0.3232, 0),
  mass: lin(0.3083, 0.5298, 0),
  space: lin(0.4466, 0.7524, 0),
  time: lin(0.5929, 0.9882, 0),
  spread: 0.01,
};

/**
 * Load the Omni crystal body (OmniCrystalExport1_8-21-25.fbx under Crystal.prefab, scale 10) and shade it the
 * way OmniCrystalFresnelShader does at rest:
 *   colour = lerp(elementBright, _DarkColor, (1 + V·N) / 2)
 * so the faces turned to the camera are near-black and the silhouette glows lime. Each of the 122 plates gets
 * its element by its corner count, as CrystalElementPlates classifies them: 10 corners Charge, 6 Mass, 8 at one
 * distance from the centre Space, 8 at two distances (a rhombus) Time. The charge arcs and depth prisms
 * (OmniChargeArcs, OmniCrystalTriangles) are not ported yet.
 */
async function loadCrystalBody(): Promise<THREE.Mesh> {
  const gltf = await new GLTFLoader().parseAsync(await loadBytes('crystal.glb'), '');
  let mesh: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !mesh) mesh = o as THREE.Mesh;
  });
  if (!mesh) throw new Error('crystal.glb has no mesh');
  const m = mesh as THREE.Mesh;
  m.updateWorldMatrix(true, false);
  const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
  geo.setAttribute('aBright', new THREE.BufferAttribute(plateColours(geo), 3));
  // Cull Off, as the game's pass: through the gaps between plates you see the far plates' inner faces, which
  // turn away from the camera and so wear the bright lime, the look the Home screen's crystal has.
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uDark: { value: OMNI.dark }, uSpread: { value: OMNI.spread } },
    vertexShader: /* glsl */ `
      attribute vec3 aBright;
      uniform float uSpread;
      varying vec3 vBright;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vBright = aBright;
        // SpreadFresnelDisplace: push along the normal by _Spread in world units
        vec3 sc = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
        vec3 p = position + normalize(normal) * (uSpread / sc);
        vec4 w = modelMatrix * vec4(p, 1.0);
        vPosW = w.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uDark;
      varying vec3 vBright;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vec3 v = normalize(cameraPosition - vPosW);
        float f = (1.0 + dot(v, vNormalW)) / 2.0;
        gl_FragColor = vec4(mix(vBright, uDark, f), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(geo, material);
}

/** The bright colour of every vertex, by the element of the plate it belongs to. */
function plateColours(geo: THREE.BufferGeometry): Float32Array {
  const pos = geo.attributes.position;
  const n = pos.count;
  // weld by position, then union the corners of every triangle into plates
  const key = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const weld = new Map<string, number>();
  const corner = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let c = weld.get(k);
    if (c === undefined) {
      c = weld.size;
      weld.set(k, c);
    }
    corner[i] = c;
  }
  const parent = Array.from({ length: weld.size }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const index = geo.index;
  const tri = (t: number) => (index ? index.getX(t) : t);
  const triCount = index ? index.count : n;
  for (let t = 0; t < triCount; t += 3) {
    const a = find(corner[tri(t)]);
    parent[find(corner[tri(t + 1)])] = a;
    parent[find(corner[tri(t + 2)])] = a;
  }
  const plates = new Map<number, Set<number>>();
  const firstVertex = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const p = find(corner[i]);
    if (!plates.has(p)) plates.set(p, new Set());
    plates.get(p)!.add(corner[i]);
    if (!firstVertex.has(corner[i])) firstVertex.set(corner[i], i);
  }
  const colourOf = new Map<number, THREE.Color>();
  for (const [p, corners] of plates) {
    let c = OMNI.bright;
    if (corners.size === 10) c = OMNI.charge;
    else if (corners.size === 6) c = OMNI.mass;
    else if (corners.size === 8) {
      const pts = [...corners].map((k) => new THREE.Vector3().fromBufferAttribute(pos, firstVertex.get(k)!));
      const centre = pts.reduce((s, q) => s.add(q), new THREE.Vector3()).multiplyScalar(1 / pts.length);
      const d = pts.map((q) => q.distanceTo(centre));
      const spread = (Math.max(...d) - Math.min(...d)) / Math.max(...d);
      c = spread > 0.02 ? OMNI.time : OMNI.space;
    }
    colourOf.set(p, c);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colourOf.get(find(corner[i]))!.toArray(out, i * 3);
  return out;
}

export class Crystal {
  readonly object = new THREE.Group();
  private readonly body = new THREE.Group();
  private pop = 1; // 0..1, the grow-in after a relocation

  constructor(private readonly rng: Rng) {
    this.object.add(this.body);
    this.body.scale.setScalar(10); // Crystal.prefab
    this.object.name = 'Crystal';
    this.relocate();
    this.pop = 1;
  }

  /** Load the body mesh; until then the crystal is an empty marker the pilot still chases. */
  async load(): Promise<void> {
    this.body.add(await loadCrystalBody());
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  /** Move to a new random spot in the nucleus ball, at least 5 units from the old one. */
  relocate(): void {
    const last = this.object.position.clone();
    const p = new THREE.Vector3();
    for (let i = 0; i < 50; i++) {
      // uniform in the ball: direction from a normal-ish draw, radius by the cube root
      const u = this.rng.range(-1, 1);
      const a = this.rng.range(0, Math.PI * 2);
      const s = Math.sqrt(1 - u * u);
      const r = CRYSTAL_SPAWN_RADIUS * Math.cbrt(this.rng.next());
      p.set(s * Math.cos(a), u, s * Math.sin(a)).multiplyScalar(r);
      if (p.distanceToSquared(last) > 25) break;
    }
    this.object.position.copy(p);
    this.pop = 0;
  }

  update(dt: number, t: number): void {
    this.body.rotation.y = t * 0.3;
    this.pop = Math.min(1, this.pop + dt / 0.6);
    const k = 1 - Math.pow(1 - this.pop, 3);
    this.body.scale.setScalar(10 * Math.max(0.001, k));
  }
}
