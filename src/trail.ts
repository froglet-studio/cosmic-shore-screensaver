import * as THREE from 'three';
import { makePrismMaterial } from './garland';
import type { DomainColors } from './palette';

/**
 * A vessel's prism trail, laid the way the game's VesselPrismController lays the Squirrel's
 * (Squirrel.prefab): two rails, one each side, a pair every `wavelength` = 7 units of travel,
 * after a 2 s start delay. Each rail prism is the slab BaseScale (20, 0.75, 5.5) with the Gap 18.5
 * cut out of its middle, so it is 20/2 − 9.25 = 0.75 wide, centred 0.75/2 + 9.25 = 9.625 off the
 * flight line, and it takes the hull's rotation.
 *
 * Unlike the game, the trail is a FIXED ring (the plan's D4): once full, the oldest prisms shrink
 * away as new ones are laid, so memory and draw cost never grow however long the screensaver runs.
 */
const BASE = new THREE.Vector3(0.75, 0.75, 5.5);
const HALF_GAP_SHIFT = 0.75 / 2 + 9.25;
const WAVELENGTH = 7;
const START_DELAY = 2;
const GROW_S = 0.6; // the prism grow-in (PrismScaleAnimator)
const FADE_COUNT = 80; // how many of the oldest prisms are shrinking at any time

export class Trail {
  readonly mesh: THREE.InstancedMesh;
  private readonly born: Float32Array;
  private readonly pos: Float32Array;
  private readonly rot: Float32Array;
  private head = 0; // next slot to write
  private filled = 0;
  private travelled = 0;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly lastPos = new THREE.Vector3();
  private hasLast = false;

  constructor(readonly capacity: number, domain: DomainColors) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const inside = new Float32Array(capacity * 3);
    const outside = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) {
      domain.inside.toArray(inside, i * 3);
      domain.outside.toArray(outside, i * 3);
    }
    geo.setAttribute('aInside', new THREE.InstancedBufferAttribute(inside, 3));
    geo.setAttribute('aOutside', new THREE.InstancedBufferAttribute(outside, 3));
    this.mesh = new THREE.InstancedMesh(geo, makePrismMaterial(), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'Trail';
    this.born = new Float32Array(capacity);
    this.pos = new Float32Array(capacity * 3);
    this.rot = new Float32Array(capacity * 4);
  }

  /** Lay prisms for the distance the vessel covered since the last call, then animate. */
  update(t: number, at: THREE.Vector3, hull: THREE.Quaternion): void {
    if (t >= START_DELAY) {
      if (!this.hasLast) {
        this.lastPos.copy(at);
        this.hasLast = true;
      }
      this.travelled += at.distanceTo(this.lastPos);
      this.lastPos.copy(at);
      if (this.travelled >= WAVELENGTH) {
        this.travelled %= WAVELENGTH;
        this.right.set(1, 0, 0).applyQuaternion(hull);
        this.lay(t, this.p.copy(at).addScaledVector(this.right, HALF_GAP_SHIFT), hull);
        this.lay(t, this.p.copy(at).addScaledVector(this.right, -HALF_GAP_SHIFT), hull);
      }
    }
    this.animate(t);
  }

  private lay(t: number, p: THREE.Vector3, q: THREE.Quaternion): void {
    const i = this.head;
    this.born[i] = t;
    p.toArray(this.pos, i * 3);
    q.toArray(this.rot, i * 4);
    this.head = (this.head + 1) % this.capacity;
    this.filled = Math.min(this.capacity, this.filled + 1);
  }

  private animate(t: number): void {
    const n = this.filled;
    // age rank 0 = oldest; the slot of rank r is (head - n + r) mod capacity
    for (let r = 0; r < n; r++) {
      const i = (this.head - n + r + this.capacity) % this.capacity;
      let k = Math.min(1, (t - this.born[i]) / GROW_S);
      k = 1 - Math.pow(1 - k, 3);
      if (n === this.capacity && r < FADE_COUNT) k *= r / FADE_COUNT;
      this.p.fromArray(this.pos, i * 3);
      this.q.fromArray(this.rot, i * 4);
      this.s.copy(BASE).multiplyScalar(Math.max(k, 1e-4));
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
