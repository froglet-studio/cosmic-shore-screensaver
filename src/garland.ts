import * as THREE from 'three';
import { DOMAINS } from './palette';
import { loadBytes, loadJson } from './content';

interface GarlandMeta {
  count: number;
  stride_floats: number;
  domain_offset: number;
  kind_offset: number;
}

/**
 * The prism look shared by the Garland and every trail, ported from the game's BlockGraph (an Unlit URP
 * Shader Graph): BlockGraph -> PrismSubGraph -> DistanceSpreadAndColors -> FresnelColors -> FresnelPower4.
 *
 *   rim     = lerp(Bright, Dark, min(d² / _SqrDistance, 1) * 0.9)     d = camera-to-prism distance
 *   fresnel = (1 - x)^4, x = N·V, or (N·V + 1) * 0.2 on a face turned away
 *   colour  = lerp(Dark, rim, fresnel)
 *
 * Bright is the colour set's InsideBlockColor and Dark its OutsideBlockColor (aInside / aOutside per
 * instance). ThemeManager hands them to the material with Material.SetColor, which in the game's linear colour
 * space converts them from gamma, so the shader does the same. _SqrDistance is 100,000 on every prism material
 * (PrismMaterial, Shielded, SuperShielded), so beyond ~316 units the rim is 90% of the way to the base: a far
 * prism reads by its faces, and the near ones light up as the camera comes close. The vertex effects of the
 * graph (grow, sway, jiggle, flight, suction) are not on the Home screen at rest and are left out.
 */
export const PRISM_SQR_DISTANCE = 100000;

export function makePrismMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uSqrDistance: { value: PRISM_SQR_DISTANCE } },
    vertexShader: /* glsl */ `
      attribute vec3 aInside;
      attribute vec3 aOutside;
      uniform float uSqrDistance;
      varying vec3 vRim;
      varying vec3 vDark;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      vec3 gammaToLinear(vec3 c) {
        return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
      }
      void main() {
        vec3 bright = gammaToLinear(aInside);
        vDark = gammaToLinear(aOutside);
        vec4 objW = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 toCam = cameraPosition - objW.xyz;
        float k = min(dot(toCam, toCam) / uSqrDistance, 1.0) * 0.9;
        vRim = mix(bright, vDark, k);
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vPosW = w.xyz;
        vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vRim;
      varying vec3 vDark;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vec3 v = normalize(cameraPosition - vPosW);
        float x = dot(normalize(vNormalW), v);
        x = x > 0.0 ? x : (x + 1.0) * 0.2;
        float f = (1.0 - x) * (1.0 - x);
        f *= f;
        gl_FragColor = vec4(mix(vDark, vRim, f), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export async function loadGarland(): Promise<THREE.InstancedMesh> {
  const [meta, buf] = await Promise.all([loadJson<GarlandMeta>('garland.json'), loadBytes('garland.bin')]);
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

  const mat = makePrismMaterial();

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
