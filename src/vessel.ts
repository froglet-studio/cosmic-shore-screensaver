import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { DomainColors } from './colours';
import { loadBytes } from './content';

/**
 * Load a vessel glTF (tools/export/export_vessel.py) and dress it from its material SLOT names,
 * the same four slots the game's VesselGraph keys: Body, Domain, Engine, Window.
 * The game's shaders are never shipped; this is the screensaver's own flat-emissive look.
 */
export async function loadVessel(name: string, domain: DomainColors): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().parseAsync(await loadBytes(name), '');
  const root = gltf.scene;
  const slot = (name: string): THREE.Material => {
    const n = name.toLowerCase();
    if (n.startsWith('domain')) return new THREE.MeshBasicMaterial({ color: domain.ship2.clone().multiplyScalar(1.6) });
    if (n.startsWith('engine')) return new THREE.MeshBasicMaterial({ color: domain.trail.clone().multiplyScalar(2.2) });
    if (n.startsWith('window')) return new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.65, 1.4) });
    return new THREE.MeshLambertMaterial({ color: new THREE.Color(0.035, 0.04, 0.07), emissive: domain.ship1 });
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    m.material = Array.isArray(m.material) ? m.material.map((x) => slot(x.name)) : slot(m.material.name);
  });
  root.name = 'Vessel';
  return root;
}
