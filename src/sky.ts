import * as THREE from 'three';
import { SKY_GLSL, SKY_VALUES } from './sky_shader';

/**
 * The game's HyperSea sky (src/sky_shader.ts, generated from HyperSeaSkybox.shader + its material).
 *
 * The full shader is costly per pixel (a 27-cell star search and a 27-cell Voronoi on top of ~30 noise
 * lookups), and it changes only slowly (drift 0.1, star twinkle). So, like the game's own low-tier
 * StaticHyperSeaSkybox, it is baked into a cube map, and the screensaver draws the cube map as the background.
 * One face is re-baked per REFRESH_S seconds, so the slow drift still shows while the per-frame cost is one
 * texture lookup.
 */
const FACE_SIZE = 768;
const REFRESH_S = 1.0;

export class Sky {
  readonly target: THREE.WebGLCubeRenderTarget;
  private readonly bakeScene = new THREE.Scene();
  private readonly cubeCamera: THREE.CubeCamera;
  private readonly material: THREE.ShaderMaterial;
  private face = 0;
  private lastBake = -Infinity;

  constructor() {
    // Half-float, linear: the galactic band and core are HDR (well above 1), and the game's bloom feeds on that
    // excess, so an 8-bit target would clip the bright band to a faint glow. 768² x 6 x 8 bytes is about 28 MB.
    this.target = new THREE.WebGLCubeRenderTarget(FACE_SIZE, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.cubeCamera = new THREE.CubeCamera(0.1, 10, this.target);
    const uniforms: Record<string, THREE.IUniform> = { uTime: { value: 0 } };
    for (const [k, v] of Object.entries(SKY_VALUES)) {
      uniforms[k] = { value: Array.isArray(v) ? new THREE.Vector3(v[0], v[1], v[2]) : v };
    }
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${SKY_GLSL}
        varying vec3 vDir;
        void main() {
          // three.js is right-handed, Unity left-handed: the same direction has z negated
          vec3 d = vec3(vDir.x, vDir.y, -vDir.z);
          gl_FragColor = vec4(hyperSeaColor(d), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.material);
    this.bakeScene.add(sphere);
  }

  get texture(): THREE.CubeTexture {
    return this.target.texture;
  }

  /** Bake all six faces now (at load). */
  bakeAll(renderer: THREE.WebGLRenderer, t: number): void {
    this.material.uniforms.uTime.value = t;
    this.cubeCamera.update(renderer, this.bakeScene);
    this.lastBake = t;
  }

  /** Re-bake one face when its turn comes. */
  update(renderer: THREE.WebGLRenderer, t: number): void {
    if (t - this.lastBake < REFRESH_S) return;
    this.lastBake = t;
    this.material.uniforms.uTime.value = t;
    const cam = this.cubeCamera.children[this.face] as THREE.PerspectiveCamera;
    this.cubeCamera.updateMatrixWorld();
    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.target, this.face);
    renderer.render(this.bakeScene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = prevXr;
    this.face = (this.face + 1) % 6;
  }
}
