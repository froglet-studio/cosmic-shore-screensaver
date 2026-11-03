import * as THREE from 'three';

/**
 * M0 stand-in for the game's HyperSea skybox (CosmicShore/HyperSeaSkybox, 773 lines of HLSL).
 * It carries the same deep colour, a galactic band along the same plane normal and a hashed
 * star field, so the scene reads right while the real port waits for M2.
 */
export function makeSky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uDeep: { value: new THREE.Color(0.008, 0.005, 0.035) },
      uBand: { value: new THREE.Color(0.3773585, 0.26409683, 0.11510615) },
      uNebula: { value: new THREE.Color(0.023529422, 0.027056675, 0.5176471) },
      // Unity (0.1, 1, 0.15) with z negated for three.js
      uGalNormal: { value: new THREE.Vector3(0.1, 1, -0.15).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uDeep; uniform vec3 uBand; uniform vec3 uNebula; uniform vec3 uGalNormal;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 p) {
        vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      void main() {
        vec3 d = normalize(vDir);
        float g = abs(dot(d, uGalNormal));
        float n = noise(d * 6.0) * 0.6 + noise(d * 13.4) * 0.4;
        float band = exp(-g * g / 0.012) * (0.55 + 0.45 * n);
        vec3 col = uDeep + uBand * band * 0.43 + uNebula * 0.4 * smoothstep(0.45, 0.9, noise(d * 2.5));
        // hashed stars: one candidate per grid cell, drawn as a soft dot at a jittered centre
        vec3 sp = d * 220.0;
        vec3 cell = floor(sp);
        float h = hash(cell);
        vec3 centre = cell + 0.25 + 0.5 * vec3(hash(cell + 3.1), hash(cell + 5.7), hash(cell + 9.3));
        float r = length(sp - centre);
        float star = step(0.985 - band * 0.01, h) * smoothstep(0.16, 0.0, r) * (0.35 + 0.65 * hash(cell + 7.0));
        col += vec3(0.85, 0.9, 1.0) * star * 0.9;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.name = 'Sky';
  return mesh;
}
