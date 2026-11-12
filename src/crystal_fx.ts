import * as THREE from 'three';
import { DEPTH, ARCS } from './crystal_fx_data';
import { loadJson } from './content';
import { traced } from './colours';

/**
 * The Omni crystal's two element effects, ported from the game (Docs/PALETTE.md §2.10 in the game repo):
 *
 *   MASS, "sealed by depth" (CrystalDepthPrisms + DepthRatchet + OmniDepthPrismShader). The 20 triangular prisms sit
 *   in columns over their holes in the body. Where a prism is in its column is set by its depth from the camera, not a
 *   clock: d = plate direction · camera direction in the crystal's space, seat = smoothstep(open, seal, d). In view a
 *   prism only moves DOWN (the ratchet); hidden behind the body it climbs back to the top; so the crystal plays a
 *   Shepard tone however it is turned.
 *
 *   CHARGE, the flux arc (CrystalChargeArcs in Flux mode + ChargeArcs + CrystalChargeArcsShader). A pentagon charges,
 *   an arc leaps to a pentagon 55-125 degrees away as five strands corner to corner (fanned at each end, one braided
 *   coaxial bundle between), both pentagons light, it fades, and the next leaps on from the sink. An arc running
 *   through a raised Mass prism lights that prism (the strike).
 *
 * Everything here is in the BODY's space (the crystal.glb body with its node rotation baked in, before Crystal.prefab's
 * scale 10), the space the arcs and the body share; the prism mesh is drawn inside it at its prefab scale.
 */

const lin = (c: readonly number[]) => new THREE.Color(c[0], c[1], c[2]).convertSRGBToLinear();
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

// ── Mass: the depth prisms ───────────────────────────────────────────────────────────────────────────────

interface PrismMesh {
  scale: number;
  position: number[];
  normal: number[];
  plate: number[];
  index: number[];
}

interface Column {
  place: number; // 0 top .. 1 sealed (the arriving prism)
  fade: number; // its fade-in, 1 = solid; the leaving prism shows 1 - fade
  leaving: number; // where the leaving prism sits while it fades
}

const PRISM_VERT = /* glsl */ `
  attribute vec4 aPlate;   // xyz the plate centre, w its index
  uniform vec4 uState[20]; // (arriving u, its fade, leaving u, strike)
  uniform float uLeaving;
  uniform float uReach, uScaleStart, uThickness, uInward, uTopHeight, uFaceSplit, uSplitUnit, uSpread;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying float vAlpha;
  varying float vStrike;
  vec3 columnPosition(vec3 vertex, vec3 n, vec3 centre, float u) {
    vec3 dir = normalize(centre);
    float rr = length(centre);
    float k = mix(uReach, 1.0, u);
    vec3 local = vertex - centre;
    local += dir * (dot(local, dir) - uTopHeight * uInward) * (uThickness - 1.0);
    local += normalize(n) * uFaceSplit * uSplitUnit * (1.0 - u);
    float ls = k * mix(uScaleStart, 1.0, u);
    return dir * rr * k + local * ls;
  }
  void main() {
    vec4 st = uState[int(aPlate.w + 0.5)];
    float u = uLeaving > 0.5 ? st.z : st.x;
    vAlpha = uLeaving > 0.5 ? 1.0 - st.y : st.y;
    vStrike = max(st.w, 0.0);
    vec3 p = columnPosition(position, normal, aPlate.xyz, u);
    // OmniCrystalFresnelShader's push: out along the normal by _Spread WORLD units
    vec3 sc = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
    p += normalize(normal) * (uSpread / sc);
    vec4 w = modelMatrix * vec4(p, 1.0);
    vPosW = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = vAlpha <= 0.0 ? vec4(0.0, 0.0, 0.0, 1.0) : projectionMatrix * viewMatrix * w;
  }`;

const PRISM_FRAG = /* glsl */ `
  uniform vec3 uBright, uDark, uStrikeColor;
  uniform float uLeaving;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying float vAlpha;
  varying float vStrike;
  void main() {
    // the screen-door dissolve on interleaved gradient noise; the leaving prism takes the complementary pixels
    float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float threshold = n * 0.998 + 0.001;
    if (uLeaving > 0.5) threshold = 1.0 - threshold;
    if (vAlpha - threshold < 0.0) discard;
    vec3 v = normalize(cameraPosition - vPosW);
    float f = (1.0 + dot(v, normalize(vNormalW))) / 2.0;
    vec3 col = mix(uBright, uDark, f) + uStrikeColor * vStrike;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

export class DepthPrisms {
  readonly object = new THREE.Group();
  private readonly dirs: THREE.Vector3[] = [];
  private readonly centres: THREE.Vector3[] = [];
  private readonly tops: number[] = [];
  private readonly bounds: number[] = [];
  private readonly plateRadius: number;
  private readonly columns: Column[] = [];
  private readonly state: THREE.Vector4[] = [];
  readonly strike: number[];
  private fresh = true;

  private constructor(mesh: PrismMesh) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normal, 3));
    geo.setAttribute('aPlate', new THREE.Float32BufferAttribute(mesh.plate, 4));
    geo.setIndex(mesh.index);
    const count = Math.max(...mesh.plate.filter((_, i) => i % 4 === 3)) + 1;
    for (let j = 0; j < count; j++) {
      this.dirs.push(new THREE.Vector3());
      this.centres.push(new THREE.Vector3());
      this.tops.push(-Infinity);
      this.bounds.push(0);
      this.state.push(new THREE.Vector4(1, 1, 1, 0));
    }
    this.strike = new Array(count).fill(0);
    const v = new THREE.Vector3();
    for (let i = 0; i < mesh.plate.length / 4; i++) {
      const j = mesh.plate[i * 4 + 3];
      this.centres[j].set(mesh.plate[i * 4], mesh.plate[i * 4 + 1], mesh.plate[i * 4 + 2]);
    }
    for (let j = 0; j < count; j++) this.dirs[j].copy(this.centres[j]).normalize();
    for (let i = 0; i < mesh.plate.length / 4; i++) {
      const j = mesh.plate[i * 4 + 3];
      v.set(mesh.position[i * 3], mesh.position[i * 3 + 1], mesh.position[i * 3 + 2]).sub(this.centres[j]);
      this.tops[j] = Math.max(this.tops[j], v.dot(this.dirs[j]));
      this.bounds[j] = Math.max(this.bounds[j], v.length());
    }
    this.plateRadius = this.centres.reduce((s, c) => s + c.length(), 0) / count;

    const uniforms = {
      uState: { value: this.state },
      uLeaving: { value: 0 },
      uReach: { value: DEPTH.reach },
      uScaleStart: { value: DEPTH.plateScaleStart },
      uThickness: { value: DEPTH.thickness },
      uInward: { value: DEPTH.thicknessInward },
      uTopHeight: { value: DEPTH.topHeight },
      uFaceSplit: { value: DEPTH.faceSplit },
      uSplitUnit: { value: DEPTH.splitUnit },
      uSpread: { value: DEPTH.spread },
      uBright: { value: traced('depth._BrightColor', lin(DEPTH.bright)) },
      uDark: { value: traced('depth._DarkColor', lin(DEPTH.dark)) },
      uStrikeColor: { value: traced('depth._StrikeColor', lin(DEPTH.strike)) },
    };
    // Two passes, as the game's two: the arriving prism and, during a reseat, the leaving one (Cull Off, opaque)
    for (const leaving of [0, 1]) {
      const material = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { ...uniforms, uLeaving: { value: leaving } },
        vertexShader: PRISM_VERT,
        fragmentShader: PRISM_FRAG,
      });
      const m = new THREE.Mesh(geo, material);
      m.frustumCulled = false;
      this.object.add(m);
    }
    this.object.scale.setScalar(mesh.scale);
    this.object.name = 'OmniDepthPrisms';
  }

  static async load(): Promise<DepthPrisms> {
    return new DepthPrisms(await loadJson<PrismMesh>('crystal_prisms.json'));
  }

  /** Where prism j stands now, in BODY space: its centre and radius (CrystalDepthPrisms.ColumnBody). */
  prismBody(j: number, out: THREE.Vector3): number {
    const place = this.columns[j]?.place ?? 1;
    const k = THREE.MathUtils.lerp(DEPTH.reach, 1, place);
    const scale = k * THREE.MathUtils.lerp(DEPTH.plateScaleStart, 1, place);
    out.copy(this.centres[j]).multiplyScalar(k * this.object.scale.x);
    return (this.bounds[j] + DEPTH.faceSplit * DEPTH.splitUnit * (1 - place)) * scale * this.object.scale.x;
  }

  placeOf(j: number): number {
    return this.columns[j]?.place ?? 1;
  }

  get count(): number {
    return this.dirs.length;
  }

  /** One step of every column against an eye at `eye` in the prisms' own space (CrystalDepthPrisms.StepColumns). */
  update(eye: THREE.Vector3, dt: number): void {
    const distance = eye.length();
    if (distance < 1e-4) return;
    const toCamera = eye.clone().divideScalar(distance);
    const seal = DEPTH.sealAtHorizon
      ? Math.min(0.999, this.plateRadius / Math.max(distance, this.plateRadius * 1.01) - DEPTH.horizonMargin)
      : DEPTH.sealDepth;
    const rise = DEPTH.riseWhileHidden && !this.fresh;
    const occluder = DEPTH.occluderRadius * this.plateRadius;
    const top = new THREE.Vector3();
    for (let j = 0; j < this.dirs.length; j++) {
      const depth = this.dirs[j].dot(toCamera);
      const e = THREE.MathUtils.clamp((depth - DEPTH.openDepth) / Math.max(seal - DEPTH.openDepth, 1e-3), 0, 1);
      const seat = Math.pow(e * e * (3 - 2 * e), DEPTH.profilePower);
      if (this.fresh) {
        this.columns[j] = { place: seat, fade: 1, leaving: 1 };
        continue;
      }
      const c = this.columns[j];
      let hidden = false;
      let target = 0;
      if (rise && seat < c.place && c.fade >= 1) {
        target = Math.max(seat, c.place - DEPTH.riseRate * dt);
        // DepthRatchet.ColumnTop, then HiddenBehindBody
        top.copy(this.centres[j]).multiplyScalar(1 + (DEPTH.reach - 1) * (1 - target));
        top.addScaledVector(this.dirs[j], this.tops[j] * (DEPTH.plateScaleStart + (1 - DEPTH.plateScaleStart) * target));
        hidden = hiddenBehindBody(top, eye, occluder);
      }
      // DepthRatchet.Step: fading, following the seat down, rising while hidden, reseating, holding
      if (c.fade < 1) {
        c.fade = Math.min(1, c.fade + dt / Math.max(DEPTH.reseatFadeSeconds, 1e-3));
        c.place = seat;
      } else if (seat >= c.place) {
        c.place = seat;
      } else if (hidden) {
        c.place = Math.max(seat, target);
      } else if (depth < DEPTH.reseatDepth) {
        c.leaving = c.place;
        c.fade = 0;
        c.place = seat;
      }
    }
    this.fresh = false;
    for (let j = 0; j < this.dirs.length; j++) {
      const c = this.columns[j];
      this.state[j].set(c.place, c.fade, c.leaving, this.strike[j]);
    }
  }

  /** Copy this frame's charge-arc strikes into the shader state (after ChargeArcs.update wrote `strike`). */
  syncStrike(): void {
    for (let j = 0; j < this.state.length; j++) this.state[j].w = this.strike[j];
  }

  /** Reseat every column where its depth puts it (a relocated crystal). */
  reset(): void {
    this.fresh = true;
  }
}

function hiddenBehindBody(point: THREE.Vector3, eye: THREE.Vector3, bodyRadius: number): boolean {
  const d = point.clone().sub(eye);
  const length = d.length();
  if (length < 1e-6) return false;
  d.divideScalar(length);
  const b = eye.dot(d);
  const c = eye.dot(eye) - bodyRadius * bodyRadius;
  const disc = b * b - c;
  if (disc <= 0) return false;
  const enter = -b - Math.sqrt(disc);
  return enter > 0 && enter < length - 1e-6;
}

// ── Charge: the flux arcs ────────────────────────────────────────────────────────────────────────────────

interface Plate {
  centre: THREE.Vector3;
  normal: THREE.Vector3;
  outerCentre: THREE.Vector3;
  outer: THREE.Vector3[];
  bound: number;
}

interface Face {
  centre: THREE.Vector3;
  ring: THREE.Vector3[];
  falloff: number[];
  falloffAtCentre: number;
}

const GLOW_LIFT = 0.006;
const CORNER_LIFT = 0.012;
const STRAND_STEPS = 96;
const BUNDLE_WOBBLE = 0.02;
const PIN_LENGTH = 0.06;
const SAMPLE_SPACING = 0.0125;
const FRAME_SAMPLES = 128;

function hash(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) ^ Math.imul(b, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x: number): number {
  const i = Math.floor(x);
  let f = x - i;
  f = f * f * (3 - 2 * f);
  return THREE.MathUtils.lerp(hash(i, 977), hash(i + 1, 977), f);
}
function fbm(x: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let o = 0; o < octaves; o++) {
    value += amplitude * (valueNoise(x * frequency + o * 19.1) * 2 - 1);
    frequency *= 2.17;
    amplitude *= 0.5;
  }
  return value;
}
const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/** ChargeFluxPath: one source -> sink arc, its centre line, its rotation-minimizing frame and its five strands. */
class FluxPath {
  readonly sourceOffsets: THREE.Vector3[] = [];
  readonly sinkOffsets: THREE.Vector3[] = [];
  private readonly sourceAxis: THREE.Vector3;
  private readonly sinkAxis: THREE.Vector3;
  private readonly angle: number;
  private readonly bow: number;
  private readonly sourceRadius: number;
  private readonly sinkRadius: number;
  private readonly frameTangent: THREE.Vector3[] = [];
  private readonly frameE1: THREE.Vector3[] = [];
  private readonly slotAngle: number[] = [];
  private readonly startOff: number[] = [];
  private readonly endOff: number[] = [];
  private readonly meanTurn: number;

  constructor(sites: ChargeSites, source: number, sink: number) {
    const cs = sites.corners[source];
    const cd = sites.corners[sink];
    const a = cs.reduce((s, c) => s.add(c), new THREE.Vector3()).divideScalar(cs.length);
    const b = cd.reduce((s, c) => s.add(c), new THREE.Vector3()).divideScalar(cd.length);
    this.sourceAxis = sites.axes[source];
    this.sinkAxis = sites.axes[sink];
    this.angle = Math.acos(THREE.MathUtils.clamp(this.sourceAxis.dot(this.sinkAxis), -1, 1));
    this.bow = 0.16 + (0.3 * this.angle) / Math.PI;
    this.sourceRadius = a.length();
    this.sinkRadius = b.length();
    for (const c of cs) {
      this.sourceOffsets.push(c.clone().sub(a));
      this.sinkOffsets.push(new THREE.Vector3());
    }
    this.buildFrame();
    const n = cs.length;
    const sourceAngles = this.sourceOffsets.map((o) => this.angleIn(o, 0));
    const sinkAngles = cd.map((c) => this.angleIn(c.clone().sub(b), 1));
    const sourceOrder = [...Array(n).keys()].sort((x, y) => sourceAngles[x] - sourceAngles[y]);
    const sinkOrder = [...Array(n).keys()].sort((x, y) => sinkAngles[x] - sinkAngles[y]);
    let bestShift = 0;
    let bestCost = Infinity;
    let bestMean = 0;
    for (let shift = 0; shift < n; shift++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += wrap(sinkAngles[sinkOrder[(i + shift) % n]] - sourceAngles[sourceOrder[i]]);
      const mean = sum / n;
      let cost = mean * mean;
      for (let i = 0; i < n; i++) {
        const d = wrap(sinkAngles[sinkOrder[(i + shift) % n]] - sourceAngles[sourceOrder[i]] - mean);
        cost += d * d;
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestShift = shift;
        bestMean = mean;
      }
    }
    const step = (2 * Math.PI) / n;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      const rel = sourceAngles[sourceOrder[i]] - i * step;
      sx += Math.cos(rel);
      sy += Math.sin(rel);
    }
    const reference = Math.atan2(sy, sx);
    this.meanTurn = bestMean;
    for (let i = 0; i < n; i++) {
      const k = sourceOrder[i];
      const j = sinkOrder[(i + bestShift) % n];
      this.sinkOffsets[k] = cd[j].clone().sub(b);
      this.slotAngle[k] = reference + i * step;
      this.startOff[k] = wrap(sourceAngles[k] - this.slotAngle[k]);
      this.endOff[k] = wrap(sinkAngles[j] - (this.slotAngle[k] + this.meanTurn));
    }
  }

  centre(u: number, out = new THREE.Vector3()): THREE.Vector3 {
    out
      .copy(this.sourceAxis)
      .multiplyScalar(Math.sin((1 - u) * this.angle))
      .addScaledVector(this.sinkAxis, Math.sin(u * this.angle))
      .normalize();
    return out.multiplyScalar(
      (this.sourceRadius + (this.sinkRadius - this.sourceRadius) * u) * (1 + this.bow * Math.sin(Math.PI * u)),
    );
  }

  strand(k: number, u: number, fork: number, bundle: number, turns: number, out: THREE.Vector3): THREE.Vector3 {
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    this.frame(u, e1, e2);
    const into = smooth(u / fork);
    const outOf = smooth((u - (1 - fork)) / fork);
    const theta =
      this.slotAngle[k] +
      this.meanTurn * smooth(u) +
      2 * Math.PI * turns * smooth((u - fork) / Math.max(1e-4, 1 - 2 * fork)) +
      this.startOff[k] * (1 - into) +
      this.endOff[k] * outOf;
    const ring = e1.multiplyScalar(Math.cos(theta)).addScaledVector(e2, Math.sin(theta)).multiplyScalar(bundle);
    this.centre(u, out);
    out.addScaledVector(this.sourceOffsets[k], 1 - into);
    out.addScaledVector(ring, into * (1 - outOf));
    out.addScaledVector(this.sinkOffsets[k], outOf);
    return out;
  }

  private buildFrame(): void {
    for (let i = 0; i <= FRAME_SAMPLES; i++) {
      const u = i / FRAME_SAMPLES;
      this.frameTangent.push(this.centre(Math.min(1, u + 0.002)).sub(this.centre(Math.max(0, u - 0.002))).normalize());
    }
    const t0 = this.frameTangent[0];
    let seed = this.sourceOffsets[0].clone().addScaledVector(t0, -this.sourceOffsets[0].dot(t0));
    if (seed.lengthSq() < 1e-12) seed = new THREE.Vector3().crossVectors(t0, Math.abs(t0.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
    this.frameE1.push(seed.normalize());
    const q = new THREE.Quaternion();
    for (let i = 1; i <= FRAME_SAMPLES; i++) {
      q.setFromUnitVectors(this.frameTangent[i - 1], this.frameTangent[i]);
      const carried = this.frameE1[i - 1].clone().applyQuaternion(q);
      this.frameE1.push(carried.addScaledVector(this.frameTangent[i], -carried.dot(this.frameTangent[i])).normalize());
    }
  }

  private frame(u: number, e1: THREE.Vector3, e2: THREE.Vector3): void {
    const x = THREE.MathUtils.clamp(u, 0, 1) * FRAME_SAMPLES;
    const i = Math.min(Math.floor(x), FRAME_SAMPLES - 1);
    const f = x - i;
    const tangent = this.frameTangent[i].clone().lerp(this.frameTangent[i + 1], f).normalize();
    const a = this.frameE1[i].clone().lerp(this.frameE1[i + 1], f);
    e1.copy(a).addScaledVector(tangent, -a.dot(tangent)).normalize();
    e2.crossVectors(tangent, e1);
  }

  private angleIn(offset: THREE.Vector3, u: number): number {
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    this.frame(u, e1, e2);
    return Math.atan2(offset.dot(e2), offset.dot(e1));
  }
}

/** ChargeSites for the omni: its 12 pentagonal prisms (the body's ten-corner plates). */
class ChargeSites {
  readonly axes: THREE.Vector3[] = [];
  readonly corners: THREE.Vector3[][] = [];
  readonly faces: Face[] = [];
  readonly radius: number;
  private readonly paths = new Map<number, FluxPath>();

  constructor(plates: THREE.Vector3[][], radius: number) {
    this.radius = radius;
    for (const corners of plates) {
      const p = readPlate(corners, ARCS.pentagonThickness);
      this.axes.push(p.outerCentre.clone().normalize());
      this.corners.push(p.outer.map((o) => o.clone().addScaledVector(p.normal, CORNER_LIFT * radius)));
      const reach = Math.max(...p.outer.map((o) => o.distanceTo(p.centre)));
      const lift = p.normal.clone().multiplyScalar(GLOW_LIFT * radius);
      this.faces.push({
        centre: p.outerCentre.clone().add(lift),
        ring: p.outer.map((o) => o.clone().add(lift)),
        falloff: p.outer.map((o) => THREE.MathUtils.clamp(o.distanceTo(p.centre) / Math.max(reach, 1e-6), 0, 1)),
        falloffAtCentre: THREE.MathUtils.clamp(p.outerCentre.distanceTo(p.centre) / Math.max(reach, 1e-6), 0, 1),
      });
    }
  }

  pathOf(source: number, sink: number): FluxPath {
    const key = source * 12 + sink;
    let path = this.paths.get(key);
    if (!path) this.paths.set(key, (path = new FluxPath(this, source, sink)));
    return path;
  }
}

function readPlate(corners: THREE.Vector3[], thickness: number): Plate {
  const centre = corners.reduce((s, c) => s.add(c), new THREE.Vector3()).divideScalar(corners.length);
  const lens = corners.map((c) => c.length());
  const mid = (Math.min(...lens) + Math.max(...lens)) / 2;
  const outer = corners.filter((c) => c.length() > mid).map((c) => c.clone());
  const inner = corners.filter((c) => c.length() <= mid);
  const outerMean = outer.reduce((s, c) => s.add(c), new THREE.Vector3()).divideScalar(outer.length);
  const innerMean = inner.reduce((s, c) => s.add(c), new THREE.Vector3()).divideScalar(inner.length);
  const normal = outerMean.clone().sub(innerMean).normalize();
  for (const o of outer) o.addScaledVector(normal, o.clone().sub(centre).dot(normal) * (thickness - 1));
  const oc = outer.reduce((s, c) => s.add(c), new THREE.Vector3()).divideScalar(outer.length);
  const ref = outer[0].clone().sub(oc).normalize();
  const ref2 = new THREE.Vector3().crossVectors(normal, ref);
  const ang = (p: THREE.Vector3) => Math.atan2(p.clone().sub(oc).dot(ref2), p.clone().sub(oc).dot(ref));
  outer.sort((x, y) => ang(x) - ang(y));
  const bound = Math.max(...corners.map((c) => c.distanceTo(centre)));
  return { centre, normal, outerCentre: oc, outer, bound };
}

/** ChargeFluxChain: discharge k's source and sink, each leaping on from the last one's sink. */
class FluxChain {
  private readonly kept: { index: number; source: number; sink: number }[] = [];
  private next = 0;
  private seed: number;
  constructor(private readonly sites: ChargeSites, seed: number) {
    this.seed = seed >>> 0 || 1;
  }
  private random(): number {
    // mulberry32 (the game's System.Random sequence is not reproduced; the RULE is)
    let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  get(index: number): { source: number; sink: number } | null {
    if (index < 0) return null;
    const lo = Math.cos(THREE.MathUtils.degToRad(ARCS.maxDegrees));
    const hi = Math.cos(THREE.MathUtils.degToRad(ARCS.minDegrees));
    while (this.next <= index) {
      const first = this.kept.length === 0;
      const last = this.kept[this.kept.length - 1];
      const source = first ? Math.floor(this.random() * 12) : last.sink;
      const candidates: number[] = [];
      for (let i = 0; i < 12; i++) {
        if (i === source || (!first && i === last.source)) continue;
        const d = this.sites.axes[source].dot(this.sites.axes[i]);
        if (d < hi && d > lo) candidates.push(i);
      }
      if (candidates.length === 0) for (let i = 0; i < 12; i++) if (i !== source) candidates.push(i);
      this.kept.push({ index: this.next++, source, sink: candidates[Math.floor(this.random() * candidates.length)] });
      if (this.kept.length > 8) this.kept.shift();
    }
    return this.kept.find((d) => d.index === index) ?? null;
  }
}

const ARC_VERT = /* glsl */ `
  attribute vec4 aData; // (across the strip -1..1, falloff 0..1, kind 0 strip / 1 face, intensity)
  varying vec4 vData;
  void main() {
    vData = aData;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const ARC_FRAG = /* glsl */ `
  uniform vec3 uBright, uCore;
  uniform float uBolt, uGlow;
  varying vec4 vData;
  void main() {
    float intensity = vData.w;
    vec3 color;
    if (vData.z < 0.5) {
      float x = vData.x;
      float heat = exp(-x * x / 0.03);
      float glow = exp(-x * x / 0.16);
      float a = intensity * max(heat, glow * 0.45) * 0.6;
      vec3 glowColor = mix(uBright, uCore, 0.3);
      color = mix(glowColor, uCore, heat * heat) * (1.0 + 1.5 * heat) * (a * uBolt);
    } else {
      float e = intensity * (0.35 + 0.65 * clamp(vData.y, 0.0, 1.0));
      color = mix(uBright, uCore, 0.55) * (e * 0.5 * uGlow);
    }
    gl_FragColor = vec4(color, 1.0); // three's AdditiveBlending is SrcAlpha, One
    #include <colorspace_fragment>
  }`;

export class ChargeArcs {
  readonly object: THREE.Mesh;
  private readonly sites: ChargeSites;
  private readonly chain: FluxChain;
  private readonly geo = new THREE.BufferGeometry();
  private positions = new Float32Array(0);
  private data = new Float32Array(0);
  private indices = new Uint32Array(0);
  private nv = 0;
  private ni = 0;
  private readonly faceLight: number[];
  private clock = 0;

  /** From the body geometry (body space): its ten-corner plates are the 12 pentagons. */
  constructor(body: THREE.BufferGeometry, seed: number) {
    const pos = body.attributes.position;
    const verts: THREE.Vector3[] = [];
    let radius = 0;
    for (let i = 0; i < pos.count; i++) {
      verts.push(new THREE.Vector3().fromBufferAttribute(pos, i));
      radius = Math.max(radius, verts[i].length());
    }
    this.sites = new ChargeSites(platesWithCorners(body, 10), radius);
    this.faceLight = new Array(this.sites.faces.length).fill(0);
    this.chain = new FluxChain(this.sites, seed);
    this.grow(4096, 8192);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: {
        uBright: { value: traced('arcs._BrightColor', lin(ARCS.bright)) },
        uCore: { value: traced('arcs._ArcCoreColor', lin(ARCS.core)) },
        uBolt: { value: ARCS.boltIntensity },
        uGlow: { value: ARCS.glowIntensity },
      },
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG,
    });
    this.object = new THREE.Mesh(this.geo, material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 2;
    this.object.name = 'OmniChargeArcs';
  }

  private grow(vertices: number, indices: number): void {
    const p = new Float32Array(vertices * 3);
    const d = new Float32Array(vertices * 4);
    const ix = new Uint32Array(indices);
    p.set(this.positions.subarray(0, this.nv * 3));
    d.set(this.data.subarray(0, this.nv * 4));
    ix.set(this.indices.subarray(0, this.ni));
    this.positions = p;
    this.data = d;
    this.indices = ix;
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aData', new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(this.indices, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.dispose(); // three keeps a GPU buffer per attribute; a bigger array needs new ones
  }

  /** The sites' radius (body space): the size the sleep rule measures on screen. */
  get radius(): number {
    return this.sites.radius;
  }

  /** Go dark (CrystalChargeArcs.Sleep): no bolt, no lit face. The clock keeps running. */
  sleep(dt: number): void {
    this.clock += dt;
    this.nv = 0;
    this.ni = 0;
    this.geo.setDrawRange(0, 0);
  }

  /** Asleep: keep only the clock, as a crystal too small to see does. */
  tick(dt: number): void {
    this.clock += dt;
  }

  /** Debug: how many triangles the light drew this frame. */
  get triangles(): number {
    return this.ni / 3;
  }

  private vertex(p: THREE.Vector3, a: number, b: number, c: number, d: number): number {
    if (this.nv + 1 > this.positions.length / 3) this.grow(this.positions.length / 3 * 2, this.indices.length);
    this.positions.set([p.x, p.y, p.z], this.nv * 3);
    this.data.set([a, b, c, d], this.nv * 4);
    return this.nv++;
  }

  private tri(a: number, b: number, c: number): void {
    if (this.ni + 3 > this.indices.length) this.grow(this.positions.length / 3, this.indices.length * 2);
    this.indices[this.ni++] = a;
    this.indices[this.ni++] = b;
    this.indices[this.ni++] = c;
  }

  /** Discharge k at time t: its source and sink light, how far it has grown, how bright (ChargeArcs.Discharge). */
  private discharge(k: number, t: number) {
    const span = 1 / Math.max(0.05, ARCS.rate);
    const gap = ARCS.gap * span;
    const charge = ARCS.charge * span;
    const struck = charge + ARCS.strike * span;
    const held = struck + ARCS.hold * span;
    const gone = held + ARCS.fade * span;
    const local = t - k * gap;
    if (local > gone) return null;
    const d = this.chain.get(k);
    if (!d) return null;
    const fading = 1 - smooth((local - held) / (gone - held));
    const sourceLight = local < charge ? 1.4 * smooth(local / charge) : local < held ? 2.2 : 2.2 * fading;
    if (local < charge) return { ...d, sourceLight, sinkLight: 0, grow: 0, intensity: 0 };
    const sinkLight = local < held ? 2.4 * smooth((local - charge) / (struck - charge)) : 2.4 * fading;
    const grow = THREE.MathUtils.clamp((local - charge) / (struck - charge), 0, 1);
    const intensity = ARCS.boltIntensity * (local < held ? 1 : fading);
    return { ...d, sourceLight, sinkLight, grow, intensity };
  }

  private strandPoints(path: FluxPath, q: number, steps: number): THREE.Vector3[] {
    const bundle = ARCS.bundle * this.sites.radius;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) pts.push(path.strand(q, i / STRAND_STEPS, ARCS.fork, bundle, ARCS.turns, new THREE.Vector3()));
    return pts;
  }

  /** Rebuild the light for time `dt` later, against an eye at `eye` (body space). Strikes go to `prisms`. */
  update(dt: number, eye: THREE.Vector3, prisms: DepthPrisms | null, prismToBody: THREE.Matrix4 | null): void {
    this.clock += dt;
    const t = this.clock;
    this.nv = 0;
    this.ni = 0;
    this.faceLight.fill(0);
    const strike = prisms ? prisms.strike.fill(0) : null;
    const span = 1 / Math.max(0.05, ARCS.rate);
    const now = Math.floor(t / (ARCS.gap * span));
    const bodies: { c: THREE.Vector3; r: number; gate: number }[] = [];
    if (prisms && prismToBody) {
      for (let j = 0; j < prisms.count; j++) {
        const c = new THREE.Vector3();
        const r = prisms.prismBody(j, c);
        const protraction = 1 - prisms.placeOf(j);
        const gate = smooth((protraction - ARCS.strikeProtractionFrom) / (ARCS.strikeProtractionFull - ARCS.strikeProtractionFrom));
        bodies.push({ c, r, gate });
      }
    }
    for (let k = now; k >= 0 && k > now - 4; k--) {
      const d = this.discharge(k, t);
      if (!d) continue;
      this.faceLight[d.source] = Math.max(this.faceLight[d.source], ARCS.glowIntensity * d.sourceLight);
      if (d.sinkLight > 0) this.faceLight[d.sink] = Math.max(this.faceLight[d.sink], ARCS.glowIntensity * d.sinkLight);
      if (d.intensity <= 0.01) continue;
      const path = this.sites.pathOf(d.source, d.sink);
      const seed = k * 53;
      const steps = Math.round(d.grow * STRAND_STEPS);
      for (let q = 0; q < path.sourceOffsets.length; q++) {
        const pts = this.strandPoints(path, q, steps);
        this.plasma(pts, d.intensity * 1.1, 0.9, BUNDLE_WOBBLE, seed, t, eye);
        if (strike) for (let j = 0; j < bodies.length; j++) strike[j] = Math.max(strike[j], strikeAlong(pts, bodies[j], d.intensity * 1.1));
      }
    }
    for (let f = 0; f < this.sites.faces.length; f++) if (this.faceLight[f] > 0) this.face(this.sites.faces[f], this.faceLight[f]);
    this.geo.setDrawRange(0, this.ni);
    for (const name of ['position', 'aData'] as const) (this.geo.attributes[name] as THREE.BufferAttribute).needsUpdate = true;
    this.geo.index!.needsUpdate = true;
  }

  private face(face: Face, intensity: number): void {
    const c = this.vertex(face.centre, 0, face.falloffAtCentre, 1, intensity);
    const ring = face.ring.map((p, k) => this.vertex(p, 0, face.falloff[k], 1, intensity));
    for (let k = 0; k < ring.length; k++) this.tri(c, ring[k], ring[(k + 1) % ring.length]);
  }

  /** ChargeArcMeshWriter.Plasma: the bolt and its fainter, thinner sub-filament. */
  private plasma(pts: THREE.Vector3[], intensity: number, width: number, wobble: number, seed: number, t: number, eye: THREE.Vector3): void {
    if (pts.length < 2 || intensity <= 0.01) return;
    const breath = 0.8 + 0.2 * fbm(t * ARCS.flickerSpeed + seed * 0.731, 2);
    this.ribbon(pts, intensity * breath, width, wobble, seed, t, eye);
    this.ribbon(pts, intensity * breath * 0.4, width * 0.45, wobble * 1.7, seed + 101, t, eye);
  }

  /** ChargeArcMeshWriter.Ribbon: resampled on a fixed grid, bent by flowing noise, a camera-facing strip. */
  private ribbon(pts: THREE.Vector3[], intensity: number, width: number, wobble: number, seed: number, t: number, eye: THREE.Vector3): void {
    const R = this.sites.radius;
    const arc: number[] = [0];
    for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = arc[arc.length - 1];
    if (total < 1e-6) return;
    const step = SAMPLE_SPACING * R;
    const flow = t * ARCS.writheSpeed;
    const phase1 = seed * 1.37;
    const phase2 = seed * 2.91 + 50;
    const bent: THREE.Vector3[] = [];
    let seg = 0;
    let next = Math.floor(0 / step) * step + step;
    if (next < 0.25 * step) next += step;
    const tangent = new THREE.Vector3();
    const n1 = new THREE.Vector3();
    const n2 = new THREE.Vector3();
    const tan = (i: number) => {
      const before = i > 0 ? pts[i].clone().sub(pts[i - 1]).normalize() : new THREE.Vector3();
      const after = i + 1 < pts.length ? pts[i + 1].clone().sub(pts[i]).normalize() : new THREE.Vector3();
      const s = before.add(after);
      return s.lengthSq() > 1e-12 ? s.normalize() : after.lengthSq() > 0 ? after : before;
    };
    for (let place = 0, guard = 0; guard++ < 512; place = total - next < 0.25 * step ? total : next, next += step) {
      while (seg < pts.length - 2 && place > arc[seg + 1]) seg++;
      const s = arc[seg + 1] - arc[seg];
      const f = s > 1e-9 ? THREE.MathUtils.clamp((place - arc[seg]) / s, 0, 1) : 0;
      const p = pts[seg].clone().lerp(pts[seg + 1], f);
      tangent.copy(tan(seg)).lerp(tan(seg + 1), f).normalize();
      n1.crossVectors(tangent, eye.clone().sub(p)).normalize();
      n2.crossVectors(tangent, n1);
      const x = (6 * place) / R;
      const pin = smooth(place / (PIN_LENGTH * R)) * smooth((total - place) / (PIN_LENGTH * R));
      const d1 = fbm(x + phase1 - flow, 3);
      const d2 = fbm(x + phase2 + flow * 0.8, 3);
      bent.push(p.addScaledVector(n1, d1 * wobble * R * pin).addScaledVector(n2, 0.6 * d2 * wobble * R * pin));
      if (place >= total) break;
    }
    const half = ARCS.coreWidth * width * 2.2 * R;
    const side = new THREE.Vector3();
    let prev = -1;
    for (let k = 0; k < bent.length; k++) {
      const p = bent[k];
      const along = bent[Math.min(k + 1, bent.length - 1)].clone().sub(bent[Math.max(k - 1, 0)]);
      side.crossVectors(along, eye.clone().sub(p)).normalize().multiplyScalar(half);
      const a = this.vertex(p.clone().add(side), 1, 0, 0, intensity);
      this.vertex(p.clone().sub(side), -1, 0, 0, intensity);
      if (prev >= 0) {
        this.tri(prev, prev + 1, a);
        this.tri(a, prev + 1, a + 1);
      }
      prev = a;
    }
  }
}

/** ChargeArcs.StrikeAlong for one prism body: full where the strand runs through its middle, nothing at the edge. */
function strikeAlong(path: THREE.Vector3[], body: { c: THREE.Vector3; r: number; gate: number }, intensity: number): number {
  if (body.r <= 0 || body.gate <= 0 || path.length < 2) return 0;
  let d = Infinity;
  const ab = new THREE.Vector3();
  const ap = new THREE.Vector3();
  for (let i = 0; i + 1 < path.length; i++) {
    ab.subVectors(path[i + 1], path[i]);
    ap.subVectors(body.c, path[i]);
    const u = THREE.MathUtils.clamp(ap.dot(ab) / Math.max(1e-12, ab.dot(ab)), 0, 1);
    d = Math.min(d, ap.addScaledVector(ab, -u).length());
  }
  const depth = d / body.r;
  if (depth >= 1) return 0;
  return ARCS.glowIntensity * 2.4 * intensity * (1 - smooth((depth - 0.6) / 0.4)) * body.gate;
}

/** The plates (connected components of position-welded triangles) with exactly `corners` corners. */
export function platesWithCorners(geo: THREE.BufferGeometry, corners: number): THREE.Vector3[][] {
  const { plateOf, cornersOf } = plateIndex(geo);
  void plateOf;
  return [...cornersOf.values()].filter((c) => c.length === corners);
}

/** Every vertex's plate id, and each plate's welded corners. */
export function plateIndex(geo: THREE.BufferGeometry): { plateOf: Int32Array; cornersOf: Map<number, THREE.Vector3[]> } {
  const pos = geo.attributes.position;
  const n = pos.count;
  const key = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const weld = new Map<string, number>();
  const corner = new Int32Array(n);
  const firstVertex: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let c = weld.get(k);
    if (c === undefined) {
      c = weld.size;
      weld.set(k, c);
      firstVertex.push(i);
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
  const plateOf = new Int32Array(n);
  const cornerSets = new Map<number, Set<number>>();
  for (let i = 0; i < n; i++) {
    const p = find(corner[i]);
    plateOf[i] = p;
    if (!cornerSets.has(p)) cornerSets.set(p, new Set());
    cornerSets.get(p)!.add(corner[i]);
  }
  const cornersOf = new Map<number, THREE.Vector3[]>();
  for (const [p, set] of cornerSets) cornersOf.set(p, [...set].map((c) => new THREE.Vector3().fromBufferAttribute(pos, firstVertex[c])));
  return { plateOf, cornersOf };
}
