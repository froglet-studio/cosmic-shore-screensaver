import * as THREE from 'three';
import type { Rng } from './rng';

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

export class Crystal {
  readonly object = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly glow: THREE.Sprite;
  private pop = 1; // 0..1, the grow-in after a relocation

  constructor(private readonly rng: Rng) {
    // A stand-in for OmniCrystalBody: a tall faceted gem with a soft halo. M2 matches the game's look.
    const geo = new THREE.OctahedronGeometry(1, 0);
    geo.scale(5.5, 9, 5.5);
    this.body = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.45, 1.6) }),
    );
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: new THREE.Color(2.2, 2.4, 2.6) }),
    );
    this.body.add(edges);
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: haloTexture(), color: 0x9fe8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.glow.scale.setScalar(70);
    this.object.add(this.body, this.glow);
    this.object.name = 'Crystal';
    this.relocate();
    this.pop = 1;
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
    this.body.rotation.y = t * 0.6;
    this.body.rotation.z = Math.sin(t * 0.4) * 0.25;
    this.pop = Math.min(1, this.pop + dt / 0.6);
    const k = 1 - Math.pow(1 - this.pop, 3);
    this.body.scale.setScalar(Math.max(0.001, k));
    this.glow.scale.setScalar(70 * k * (1 + 0.06 * Math.sin(t * 2.3)));
  }
}

function haloTexture(): THREE.Texture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const v = Math.max(0, 1 - d);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * v * v * v);
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.needsUpdate = true;
  return tex;
}
