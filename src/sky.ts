import * as THREE from 'three';
import { SKY_GLSL, SKY_VALUES } from './sky_shader';
import { traced } from './colours';

/**
 * The game's HyperSea sky (src/sky_shader.ts, generated from HyperSeaSkybox.shader + its material).
 *
 * The full shader is costly per pixel (a 27-cell star search and a 27-cell Voronoi on top of ~30 noise
 * lookups), and it changes only slowly (drift 0.1, star twinkle). So, like the game's own low-tier
 * StaticHyperSeaSkybox, it is baked into cube maps and the screensaver draws a cube map as the background.
 *
 * Every cube map is baked whole at ONE moment of the sky (a keyframe, KEY_S seconds apart), and the background
 * crossfades between two neighbouring keyframes. The keyframe after those is baked meanwhile, a few thin strips
 * per frame, into a third cube map that is never on screen until it is complete. So the six faces always show
 * the same moment (no seams where faces meet), and the drift moves smoothly instead of a face jumping when its
 * turn comes.
 *
 * Until 2026-11-18 one face was re-baked per second straight into the cube on screen, so neighbouring faces
 * showed the sky up to five seconds apart: the cell lines broke at the face edges and each re-bake was a visible
 * jump of one face.
 */
const FACE_SIZE = 768;
/** Seconds between keyframes. The cell lines drift ~0.07 cell-space units in that time, about one line width,
 *  so a crossfade between neighbouring keyframes reads as motion, not as two lines. */
const KEY_S = 2.0;
/** Strips per face: the bake work is spread over the frames of one keyframe interval. */
const STRIPS = 16;
const UNITS = 6 * STRIPS;
/** At most a quarter face per frame, so a slow GPU never gets a long frame: there the sky's own clock slips
 *  (it holds on the newest keyframe until the next is finished) instead of the frame rate. */
const MAX_STRIPS_PER_FRAME = 4;

const BG_VERTEX = /* glsl */ `
  varying vec3 vWorldDirection;
  #include <common>
  void main() {
    vWorldDirection = transformDirection(position, modelMatrix);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w; // on the far plane
  }`;
const BG_FRAGMENT = /* glsl */ `
  uniform samplerCube uFrom;
  uniform samplerCube uTo;
  uniform float uMix;
  varying vec3 vWorldDirection;
  void main() {
    gl_FragColor = mix(textureCube(uFrom, vWorldDirection), textureCube(uTo, vWorldDirection), uMix);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Sky {
  /** The background: a unit box that follows the camera and blends two keyframes. Add it to the scene. */
  readonly background: THREE.Mesh;
  /** keys[0] is the keyframe at skyTime, keys[1..ready] the ones after it (KEY_S apart), keys[ready + 1] the one
   *  being baked. */
  private readonly keys: THREE.WebGLCubeRenderTarget[];
  private readonly bakeScene = new THREE.Scene();
  private readonly cubeCamera: THREE.CubeCamera;
  private readonly material: THREE.ShaderMaterial;
  private readonly bgMaterial: THREE.ShaderMaterial;
  private skyTime = 0; // the sky's moment in keys[0]
  private ready = 0; // finished keyframes after keys[0]
  private fadeStart = 0; // wall time the fade keys[0] -> keys[1] began
  private bakeStart = 0; // wall time the bake in progress began
  private baked = 0; // strips of the bake in progress done

  constructor() {
    // Half-float, linear: the galactic band and core are HDR (well above 1), and the game's bloom feeds on that
    // excess, so an 8-bit target would clip the bright band to a faint glow. 768² x 6 x 8 bytes is about 28 MB
    // per cube map, three of them.
    const make = () =>
      new THREE.WebGLCubeRenderTarget(FACE_SIZE, {
        type: THREE.HalfFloatType,
        colorSpace: THREE.LinearSRGBColorSpace,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
    this.keys = [make(), make(), make()];
    this.cubeCamera = new THREE.CubeCamera(0.1, 10, this.keys[0]);
    const uniforms: Record<string, THREE.IUniform> = { uTime: { value: 0 } };
    // Colours as the worn colour set retraces them (src/colours.ts); directions and numbers as the material has them.
    for (const [k, v] of Object.entries(SKY_VALUES)) {
      if (!Array.isArray(v)) {
        uniforms[k] = { value: v };
        continue;
      }
      const c = traced(`sky.${k}`, new THREE.Color(v[0], v[1], v[2]));
      uniforms[k] = { value: new THREE.Vector3(c.r, c.g, c.b) };
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

    this.bgMaterial = new THREE.ShaderMaterial({
      name: 'SkyBackground',
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      uniforms: {
        uFrom: { value: this.keys[0].texture },
        uTo: { value: this.keys[1].texture },
        uMix: { value: 0 },
      },
      vertexShader: BG_VERTEX,
      fragmentShader: BG_FRAGMENT,
    });
    this.background = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.bgMaterial);
    this.background.frustumCulled = false;
    this.background.renderOrder = -1e9; // first, like scene.background
    this.background.onBeforeRender = (_r, _s, camera) => {
      this.background.matrixWorld.copyPosition(camera.matrixWorld);
    };
  }

  /** Bake the first keyframe whole (at load); the next is baked in strips from the first update on. */
  bakeAll(renderer: THREE.WebGLRenderer, t: number): void {
    this.cubeCamera.renderTarget = this.keys[0];
    this.material.uniforms.uTime.value = t;
    this.cubeCamera.update(renderer, this.bakeScene);
    this.skyTime = t;
    this.ready = 0;
    this.baked = 0;
    this.bakeStart = this.fadeStart = t;
    this.show(0);
  }

  /** Each frame: bake the share of the next keyframe that is due, and set the crossfade for wall time t. */
  update(renderer: THREE.WebGLRenderer, t: number): void {
    if (this.ready < 2) {
      // Spread the work evenly over one interval (one strip ahead), never more than the per-frame cap.
      const due = Math.min(UNITS, Math.ceil(((t - this.bakeStart) / KEY_S) * UNITS) + 1);
      this.bakeStrips(renderer, Math.min(due, this.baked + MAX_STRIPS_PER_FRAME));
      if (this.baked >= UNITS) {
        this.ready++;
        this.baked = 0;
        this.bakeStart = t;
        if (this.ready === 1) this.fadeStart = t; // the first fade starts when its target exists
      }
    }
    if (this.ready === 0) return; // only keys[0] so far: it is on screen as is
    const f = (t - this.fadeStart) / KEY_S;
    if (f >= 1 && this.ready === 2) {
      // keys[1] is fully on screen and the one after it is ready: step on.
      this.keys.push(this.keys.shift()!);
      this.skyTime += KEY_S;
      this.ready = 1;
      // Keep the cadence, but after a stall (a sleeping host) start the next fade now rather than jump.
      this.fadeStart = t - this.fadeStart < 2 * KEY_S ? this.fadeStart + KEY_S : t;
      this.bakeStart = t;
    }
    this.show(Math.min((t - this.fadeStart) / KEY_S, 1));
  }

  private show(mix: number): void {
    const u = this.bgMaterial.uniforms;
    u.uFrom.value = this.keys[0].texture;
    u.uTo.value = this.keys[this.ready > 0 ? 1 : 0].texture;
    u.uMix.value = Math.max(mix, 0);
  }

  /** Bake keys[ready + 1] (the keyframe at skyTime + (ready + 1) KEY_S) up to `upTo` strips. */
  private bakeStrips(renderer: THREE.WebGLRenderer, upTo: number): void {
    if (this.baked >= upTo) return;
    const target = this.keys[this.ready + 1];
    this.material.uniforms.uTime.value = this.skyTime + (this.ready + 1) * KEY_S;
    this.cubeCamera.updateMatrixWorld();
    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    // setRenderTarget takes the scissor from the target itself (in target pixels, no pixel ratio).
    target.scissorTest = true;
    const rows = FACE_SIZE / STRIPS;
    for (; this.baked < upTo; this.baked++) {
      const face = Math.floor(this.baked / STRIPS);
      target.scissor.set(0, (this.baked % STRIPS) * rows, FACE_SIZE, rows);
      renderer.setRenderTarget(target, face);
      renderer.render(this.bakeScene, this.cubeCamera.children[face] as THREE.PerspectiveCamera);
    }
    target.scissorTest = false;
    target.scissor.set(0, 0, FACE_SIZE, FACE_SIZE);
    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = prevXr;
  }
}
