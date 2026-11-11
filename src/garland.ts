import * as THREE from 'three';
import { DOMAINS } from './colours';
import { loadBytes, loadJson } from './content';

interface GarlandMeta {
  count: number;
  stride_floats: number;
  domain_offset: number;
  kind_offset: number;
}

/**
 * The prism look shared by the Garland and every trail, ported from the game's BlockGraph (an Unlit URP
 * Shader Graph, alpha-clipped, drawn with PrismMaterial's _Cull 0: BOTH faces):
 *   BlockGraph -> PrismSubGraph -> DistanceSpreadAndColors -> (SpreadSubGraph, TangentSlider, FresnelColors).
 *
 * Vertex stage, the face spread (the game's own transcription is SwarmPrismSpread in SwarmMemberInstanced.hlsl):
 *   far      = Spread * (50, 35, 20)                       Spread = PrismMaterial _Spread (0.1, 0.1, 0.1)
 *   eff      = d² > _SqrDistance ? far : lerp(-7, far, d² / _SqrDistance);  eff = max(eff, Spread)
 *   position = positionOS + (eff / scale) * normalOS + ((eff - Spread) / scale) * tangentOS * 0.5
 * The prism mesh (Assets/_Models/Testing/Prism.asset) splits every face into four triangles around its centre,
 * each with its own tangent pointing out to its edge, so with distance the six faces push apart and each face's
 * four triangles slide out from its centre: a far prism opens into the triangle lattice the Home screen shows.
 *
 * Fragment stage:
 *   rim     = lerp(Bright, Dark, min(d² / _SqrDistance, 1) * 0.9)     d = camera-to-prism distance
 *   fresnel = (1 - x)^4, x = N·V, or (N·V + 1) * 0.2 on a face turned away
 *   colour  = lerp(Dark, rim, fresnel)
 *
 * Bright is the colour set's InsideBlockColor and Dark its OutsideBlockColor (aInside / aOutside per
 * instance). ThemeManager hands them to the material with Material.SetColor, which in the game's linear colour
 * space converts them from gamma, so the shader does the same. _SqrDistance is 100,000 on every prism material.
 * The other vertex effects (grow, sway, jiggle, flight, suction) are not on the Home screen at rest.
 */
export const PRISM_SQR_DISTANCE = 100000;
export const PRISM_SPREAD = 0.1;

/**
 * The game's prism mesh, Prism.asset: a unit cube whose every face is four triangles fanned around the face
 * centre (72 vertices), flat normals, and each triangle's tangent pointing from the centre out to its edge.
 */
export function makePrismGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const tan: number[] = [];
  const axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  for (const [n, u, v] of [[Z, X, Y], [X, Z, Y], [Y, X, Z]] as const) {
    axes.push([n.clone(), u.clone(), v.clone()]);
    axes.push([n.clone().negate(), u.clone().negate(), v.clone()]);
  }
  const corner = (n: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, a: number, b: number) =>
    n.clone().multiplyScalar(0.5).addScaledVector(u, a * 0.5).addScaledVector(v, b * 0.5);
  for (const [n, u, v] of axes) {
    // the four corners counter-clockwise seen from outside, then a fan of edge triangles around the centre
    const c = [corner(n, u, v, -1, -1), corner(n, u, v, 1, -1), corner(n, u, v, 1, 1), corner(n, u, v, -1, 1)];
    const centre = n.clone().multiplyScalar(0.5);
    for (let k = 0; k < 4; k++) {
      const a = c[k], b = c[(k + 1) % 4];
      const out = a.clone().add(b).multiplyScalar(0.5).sub(centre).normalize();
      for (const p of [a, b, centre]) {
        pos.push(p.x, p.y, p.z);
        nrm.push(n.x, n.y, n.z);
        tan.push(out.x, out.y, out.z, 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('tangent', new THREE.Float32BufferAttribute(tan, 4));
  return geo;
}

export function makePrismMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uSqrDistance: { value: PRISM_SQR_DISTANCE }, uSpread: { value: PRISM_SPREAD } },
    vertexShader: /* glsl */ `
      attribute vec3 aInside;
      attribute vec3 aOutside;
      attribute vec4 tangent;
      uniform float uSqrDistance;
      uniform float uSpread;
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
        mat4 model = modelMatrix * instanceMatrix;
        vec4 objW = model * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 toCam = cameraPosition - objW.xyz;
        float sqrD = dot(toCam, toCam);
        float k = min(sqrD / uSqrDistance, 1.0) * 0.9;
        vRim = mix(bright, vDark, k);
        // the face spread (SpreadSubGraph + TangentSlider)
        vec3 sp = vec3(uSpread);
        vec3 far = sp * vec3(50.0, 35.0, 20.0);
        vec3 eff = sqrD > uSqrDistance ? far : mix(vec3(-7.0), far, sqrD / uSqrDistance);
        eff = max(eff, sp);
        vec3 scl = max(vec3(length(model[0].xyz), length(model[1].xyz), length(model[2].xyz)), vec3(1e-4));
        vec3 p = position + (eff / scl) * normal + ((eff - sp) / scl) * tangent.xyz * 0.5;
        vec4 w = model * vec4(p, 1.0);
        vPosW = w.xyz;
        vNormalW = normalize(mat3(model) * (normal / (scl * scl)));
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vRim;
      varying vec3 vDark;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vec3 v = normalize(cameraPosition - vPosW);
        vec3 n = normalize(vNormalW);
        float x = dot(n, v);
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

  const geo = makePrismGeometry();
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
