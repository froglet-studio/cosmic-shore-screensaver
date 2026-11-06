import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadBytes } from './content';
import { Rng } from './rng';

/**
 * The cell's shell on the Home screen (Garland Cell Config): the nucleus cage and the capsule membrane.
 * Material colours are Material colour properties, so (the game rendering in linear space) they are converted
 * from gamma on the way in, as Unity does; Shader Graph colour NODES in HDR mode are already linear.
 */
const lin = (r: number, g: number, b: number) => new THREE.Color(r, g, b).convertSRGBToLinear();

/**
 * The nucleus: Nucleus.prefab (Node2.fbx at scale 400) with CageMaterial on CageGraph, an Unlit, transparent,
 * front-face Shader Graph at _alpha 0.1:
 *   t     = N_view.z                         (the face's facing toward the camera)
 *   base  = lerp(Edge Color, Straight Color, t)
 *   color = lerp(base, (0.0064, 0.0072, 0.0231), fresnel^1.91)
 * The graph's vertex "muton" offset is a sub-millimetre shrink at the shipped _scale (-17376) and is left out.
 */
export async function loadNucleus(): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().parseAsync(await loadBytes('nucleus.glb'), '');
  const root = gltf.scene;
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: {
      uEdge: { value: lin(0, 0.023529412, 0.7490196) },
      uStraight: { value: lin(0.32514533, 0.3480816, 0.754717) },
      uFresnelColor: { value: new THREE.Color(0.0063706073, 0.0071669333, 0.0230934508) },
      uAlpha: { value: 0.1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uEdge; uniform vec3 uStraight; uniform vec3 uFresnelColor; uniform float uAlpha;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(-vViewPos);
        vec3 base = mix(uEdge, uStraight, n.z);
        float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 1.91);
        gl_FragColor = vec4(mix(base, uFresnelColor, fres), uAlpha);
        #include <colorspace_fragment>
      }`,
  });
  const drop: THREE.Object3D[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // Node2.fbx also carries a 10-vertex "Dual-Mesh" helper the game never draws as the cage
    if (m.geometry.attributes.position.count < 100) drop.push(m);
    m.material = material;
    m.frustumCulled = false;
  });
  for (const o of drop) o.removeFromParent();
  const holder = new THREE.Group();
  holder.add(root);
  holder.scale.setScalar(400);
  holder.name = 'Nucleus';
  return holder;
}

/**
 * The membrane: CapsuleMembrane (radius 1200, icosphere level 4 = 2,562 capsules of scale (8, 60, 5), placement
 * jitter 0.15, radial jitter 0.05) drawn with SpindleMaterial on SpindleGraph, Unlit, transparent, alpha clip 0.05:
 *   s       = |object - camera|² / _Distance            (_Distance 2,000,000)
 *   near    = s < 1 ? 1 - s : 0
 *   density = (N·V)^4 * _CellDensity (1.5) * near
 *   v       = Voronoi(uv + (0, 0.5), sin(_Phase + time), density)
 *   color   = _DullColor * (1 - v) + _BrightColor * v
 *   alpha   = clamp(v, 0, 1) ^ ((s + 0.1) * 10)
 * Differences: the jitter comes from this repo's RNG, not .NET's System.Random(42), so single capsules sit a
 * little elsewhere; the Voronoi uses Shader Graph's legacy sine hash; the 10° wobble loop is not animated yet.
 */
export function makeMembrane(seed = 42): THREE.InstancedMesh {
  const radius = 1200;
  const dirs = icosphereVertices(4);
  const rng = new Rng(seed);
  const geo = new THREE.CapsuleGeometry(0.5, 1, 2, 8);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: {
      uTime: { value: 0 },
      uDull: { value: lin(0, 0.027586222, 1) },
      uBright: { value: lin(0.36976376, 0.39671606, 0.9559748) },
      uCellDensity: { value: 1.5 },
      uDistance: { value: 2000000 },
    },
    vertexShader: /* glsl */ `
      uniform float uDistance;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      varying float vS;
      void main() {
        vUv = uv;
        vec4 objW = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 d = objW.xyz - cameraPosition;
        vS = dot(d, d) / uDistance;
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vPosW = w.xyz;
        vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uDull; uniform vec3 uBright; uniform float uCellDensity;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      varying float vS;
      vec2 randomVector(vec2 uv, float offset) {
        mat2 m = mat2(15.27, 99.41, 47.63, 89.98);
        uv = fract(sin(uv * m) * 46839.32);
        return vec2(sin(uv.y * offset) * 0.5 + 0.5, cos(uv.x * offset) * 0.5 + 0.5);
      }
      float voronoi(vec2 uv, float angleOffset, float cellDensity) {
        vec2 g = floor(uv * cellDensity);
        vec2 f = fract(uv * cellDensity);
        float res = 8.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 lattice = vec2(float(x), float(y));
            vec2 o = randomVector(lattice + g, angleOffset);
            res = min(res, distance(lattice + o, f));
          }
        }
        return res;
      }
      void main() {
        float nv = dot(normalize(vNormalW), normalize(cameraPosition - vPosW));
        float invF = nv * nv; invF *= invF;
        float near = vS < 1.0 ? 1.0 - vS : 0.0;
        float density = invF * uCellDensity * near;
        float v = voronoi(vUv + vec2(0.0, 0.5), sin(uTime), density);
        float alpha = pow(clamp(v, 0.0, 1.0), (vS + 0.1) * 10.0);
        if (alpha < 0.05) discard;
        vec3 col = uDull * (1.0 - v) + uBright * v;
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, material, dirs.length);
  const m = new THREE.Matrix4();
  const flip = new THREE.Matrix4().makeScale(1, 1, -1);
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3(1, 0, 0);
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const perp = new THREE.Vector3();
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  dirs.forEach((rd, i) => {
    // CapsuleMembrane.BuildBaseData, in Unity's frame
    t1.crossVectors(rd, up);
    if (t1.lengthSq() <= 0.001) t1.crossVectors(rd, right);
    t1.normalize();
    t2.crossVectors(rd, t1).normalize();
    const ju = rng.range(-1, 1) * 0.15;
    const jv = rng.range(-1, 1) * 0.15;
    const jr = rng.range(-1, 1) * 0.05;
    dir.copy(rd).addScaledVector(t1, ju).addScaledVector(t2, jv).normalize();
    perp.crossVectors(dir, up).normalize();
    // Quaternion.LookRotation(dir, perp): x = up × forward, y = forward × x
    xAxis.crossVectors(perp, dir).normalize();
    yAxis.crossVectors(dir, xAxis);
    const p = dir.clone().multiplyScalar(radius * (1 + jr));
    m.makeBasis(xAxis.multiplyScalar(8), yAxis.multiplyScalar(60), dir.clone().multiplyScalar(5)).setPosition(p);
    // Unity -> three: S M S with S = diag(1, 1, -1)
    m.premultiply(flip).multiply(flip);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.name = 'Membrane';
  return mesh;
}

/** The unit-sphere vertices of CapsuleMembrane.GenerateIcosphereVertices (the same base and midpoint split). */
function icosphereVertices(level: number): THREE.Vector3[] {
  const phi = (1 + Math.sqrt(5)) * 0.5;
  const a = 1;
  const b = 1 / phi;
  const v: THREE.Vector3[] = [
    [0, b, -a], [b, a, 0], [-b, a, 0], [0, b, a], [0, -b, a], [-a, 0, b],
    [0, -b, -a], [a, 0, -b], [a, 0, b], [-a, 0, -b], [b, -a, 0], [-b, -a, 0],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());
  let tris = [
    2, 1, 0, 1, 2, 3, 5, 2, 3, 3, 8, 1, 3, 4, 8,
    3, 5, 4, 0, 1, 7, 7, 1, 8, 6, 7, 8, 6, 8, 10,
    8, 4, 10, 4, 11, 10, 4, 5, 11, 11, 5, 9, 9, 5, 2,
    9, 2, 0, 6, 0, 7, 9, 0, 6, 11, 9, 6, 10, 11, 6,
  ];
  for (let l = 0; l < level; l++) {
    const cache = new Map<string, number>();
    const mid = (i: number, j: number) => {
      const k = i < j ? `${i},${j}` : `${j},${i}`;
      let r = cache.get(k);
      if (r === undefined) {
        r = v.length;
        v.push(v[i].clone().add(v[j]).normalize());
        cache.set(k, r);
      }
      return r;
    };
    const next: number[] = [];
    for (let i = 0; i < tris.length; i += 3) {
      const [p, q, r] = [tris[i], tris[i + 1], tris[i + 2]];
      const pq = mid(p, q);
      const qr = mid(q, r);
      const rp = mid(r, p);
      next.push(p, pq, rp, q, qr, pq, r, rp, qr, pq, qr, rp);
    }
    tris = next;
  }
  return v;
}
