import * as THREE from 'three';
import { DOMAINS } from './palette';

interface GarlandMeta {
  count: number;
  stride_floats: number;
  domain_offset: number;
  kind_offset: number;
}

/**
 * The Garland environment: 4,259 prisms exported from the game's own generator model
 * (tools/export/export_garland.py), drawn as ONE instanced box mesh.
 *
 * The prism look is an M0 stand-in for the game's BlockGraph: a dark face (OutsideBlockColor)
 * with bright HDR edges (InsideBlockColor) that the bloom pass picks up. M2 matches it to Unity.
 */
export async function loadGarland(base: string): Promise<THREE.InstancedMesh> {
  const [meta, buf] = await Promise.all([
    fetch(`${base}garland.json`).then((r) => r.json() as Promise<GarlandMeta>),
    fetch(`${base}garland.bin`).then((r) => r.arrayBuffer()),
  ]);
  const n = meta.count;
  const f = new Float32Array(buf, 0, n * meta.stride_floats);
  const dom = new Uint8Array(buf, meta.domain_offset, n);
  const kind = new Uint8Array(buf, meta.kind_offset, n);

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const inside = new Float32Array(n * 3);
  const outside = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const d = DOMAINS[dom[i]];
    const sup = kind[i] === 2;
    (sup ? d.superInside : d.inside).toArray(inside, i * 3);
    (sup ? d.superOutside : d.outside).toArray(outside, i * 3);
  }

  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 aInside;
      attribute vec3 aOutside;
      varying vec3 vInside;
      varying vec3 vOutside;
      varying vec3 vLocal;
      varying vec3 vScale;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vInside = aInside;
        vOutside = aOutside;
        vLocal = position;
        vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vInside;
      varying vec3 vOutside;
      varying vec3 vLocal;
      varying vec3 vScale;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        // distance to the nearest edge of this face, in world units
        vec3 d = (0.5 - abs(vLocal)) * vScale;
        float a = min(d.x, d.y);
        float b = min(d.y, d.z);
        float c = min(d.x, d.z);
        vec3 an = abs(vLocal);
        float edge = an.x > an.y && an.x > an.z ? b : (an.y > an.z ? c : a);
        float w = fwidth(edge) * 1.5 + 0.18;
        float rim = 1.0 - smoothstep(0.0, w, edge);
        float fres = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir))), 2.0);
        vec3 col = mix(vOutside, vInside, clamp(rim + fres * 0.35, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, n);
  geo.setAttribute('aInside', new THREE.InstancedBufferAttribute(inside, 3));
  geo.setAttribute('aOutside', new THREE.InstancedBufferAttribute(outside, 3));
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const o = i * meta.stride_floats;
    p.set(f[o], f[o + 1], f[o + 2]);
    q.set(f[o + 3], f[o + 4], f[o + 5], f[o + 6]);
    s.set(f[o + 7], f[o + 8], f[o + 9]);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.frustumCulled = false;
  mesh.name = 'Garland';
  return mesh;
}
