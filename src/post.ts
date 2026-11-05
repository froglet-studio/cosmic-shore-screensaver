import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * The game's post stack, ported from URP 17 (the game's `com.unity.render-pipelines.universal` 17.0.4,
 * PostProcessPass.cs, Bloom.shader, PaniniProjection.shader, UberPost.shader) with the numbers of the game's
 * "GamePlay PostProcessing Profile": Bloom (threshold 0.2, intensity 2.5, scatter 0.7 default, clamp 0.5,
 * tint white, max iterations 4, low-quality filtering, half-res) and Panini projection (distance 0.7,
 * crop to fit 1). The URP asset renders HDR with no tonemapping (colour grading LDR, no tonemap override),
 * so the output simply clips at 1.
 */
export const BLOOM = { threshold: 0.2, intensity: 2.5, scatter: 0.7, clamp: 0.5, maxIterations: 4 };
export const PANINI = { distance: 0.7, cropToFit: 1 };

const gammaToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function mat(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

const PREFILTER = /* glsl */ `
  uniform sampler2D tSrc; uniform vec4 uParams; // scatter, clamp, threshold (linear), knee
  varying vec2 vUv;
  void main() {
    vec3 color = texture2D(tSrc, vUv).rgb;
    color = min(vec3(uParams.y), color);
    float brightness = max(color.r, max(color.g, color.b));
    float softness = clamp(brightness - uParams.z + uParams.w, 0.0, 2.0 * uParams.w);
    softness = (softness * softness) / (4.0 * uParams.w + 1e-4);
    float multiplier = max(brightness - uParams.z, softness) / max(brightness, 1e-4);
    color *= multiplier;
    gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
  }`;

// 2x downsample + 9-tap gaussian (texel = the SOURCE texel size x 2, as URP's FragBlurH)
const BLUR_H = /* glsl */ `
  uniform sampler2D tSrc; uniform vec2 uTexel;
  varying vec2 vUv;
  vec3 s(float o) { return texture2D(tSrc, vUv + vec2(uTexel.x * o, 0.0)).rgb; }
  void main() {
    vec3 c = s(-4.0) * 0.01621622 + s(-3.0) * 0.05405405 + s(-2.0) * 0.12162162 + s(-1.0) * 0.19459459
           + s(0.0) * 0.22702703
           + s(1.0) * 0.19459459 + s(2.0) * 0.12162162 + s(3.0) * 0.05405405 + s(4.0) * 0.01621622;
    gl_FragColor = vec4(c, 1.0);
  }`;

const BLUR_V = /* glsl */ `
  uniform sampler2D tSrc; uniform vec2 uTexel;
  varying vec2 vUv;
  vec3 s(float o) { return texture2D(tSrc, vUv + vec2(0.0, uTexel.y * o)).rgb; }
  void main() {
    vec3 c = s(-3.23076923) * 0.07027027 + s(-1.38461538) * 0.31621622
           + s(0.0) * 0.22702703
           + s(1.38461538) * 0.31621622 + s(3.23076923) * 0.07027027;
    gl_FragColor = vec4(c, 1.0);
  }`;

const UPSAMPLE = /* glsl */ `
  uniform sampler2D tSrc; uniform sampler2D tLow; uniform float uScatter;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(mix(texture2D(tSrc, vUv).rgb, texture2D(tLow, vUv).rgb, uScatter), 1.0);
  }`;

// The uber pass's bloom add, then Panini on the result (URP runs Panini before the uber pass, on the
// un-bloomed image, and samples bloom at the distorted uv; doing both here samples both at that uv, the same thing).
const COMPOSITE = /* glsl */ `
  uniform sampler2D tSrc; uniform sampler2D tBloom;
  uniform float uIntensity; uniform vec3 uTint;
  uniform vec4 uPanini; // view extents x/y, distance, scale
  varying vec2 vUv;
  vec2 paniniGeneric(vec2 view_pos, float d) {
    float view_dist = 1.0 + d;
    float view_hyp_sq = view_pos.x * view_pos.x + view_dist * view_dist;
    float isect_D = view_pos.x * d;
    float isect_discrim = view_hyp_sq - isect_D * isect_D;
    float cyl_dist_minus_d = (-isect_D * view_pos.x + view_dist * sqrt(isect_discrim)) / view_hyp_sq;
    float cyl_dist = cyl_dist_minus_d + d;
    vec2 cyl_pos = view_pos * (cyl_dist / view_dist);
    return cyl_pos / (cyl_dist - d);
  }
  void main() {
    vec2 uv = vUv;
    if (uPanini.z > 0.0) {
      vec2 view_pos = (2.0 * vUv - 1.0) * uPanini.xy * uPanini.w;
      vec2 proj_pos = paniniGeneric(view_pos, uPanini.z);
      uv = clamp((proj_pos / uPanini.xy) * 0.5 + 0.5, 0.0, 1.0);
    }
    vec3 color = texture2D(tSrc, uv).rgb;
    color += texture2D(tBloom, uv).rgb * uIntensity * uTint;
    gl_FragColor = vec4(color, 1.0);
  }`;

/** URP's bloom pyramid plus Panini, as one composer pass. Reads the HDR scene, writes HDR (OutputPass follows). */
export class GamePostPass extends Pass {
  private readonly quad = new FullScreenQuad();
  private readonly prefilter: THREE.ShaderMaterial;
  private readonly blurH: THREE.ShaderMaterial;
  private readonly blurV: THREE.ShaderMaterial;
  private readonly upsample: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private mipCount = 1;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    super();
    const threshold = gammaToLinear(BLOOM.threshold);
    const scatter = THREE.MathUtils.lerp(0.05, 0.95, BLOOM.scatter);
    this.prefilter = mat(PREFILTER, { tSrc: { value: null }, uParams: { value: new THREE.Vector4(scatter, BLOOM.clamp, threshold, threshold * 0.5) } });
    this.blurH = mat(BLUR_H, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.blurV = mat(BLUR_V, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upsample = mat(UPSAMPLE, { tSrc: { value: null }, tLow: { value: null }, uScatter: { value: scatter } });
    this.composite = mat(COMPOSITE, {
      tSrc: { value: null },
      tBloom: { value: null },
      uIntensity: { value: BLOOM.intensity },
      uTint: { value: new THREE.Vector3(1, 1, 1) }, // white / its luma (1)
      uPanini: { value: new THREE.Vector4() },
    });
  }

  setSize(width: number, height: number): void {
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.down = [];
    this.up = [];
    let tw = Math.max(1, width >> 1);
    let th = Math.max(1, height >> 1);
    const iterations = Math.floor(Math.log2(Math.max(tw, th)) - 1);
    this.mipCount = THREE.MathUtils.clamp(iterations, 1, BLOOM.maxIterations);
    for (let i = 0; i < this.mipCount; i++) {
      const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
      this.down.push(new THREE.WebGLRenderTarget(tw, th, opts));
      this.up.push(new THREE.WebGLRenderTarget(tw, th, opts));
      tw = Math.max(1, tw >> 1);
      th = Math.max(1, th >> 1);
    }
  }

  private blit(renderer: THREE.WebGLRenderer, m: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = m;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    if (this.down.length === 0) this.setSize(readBuffer.width, readBuffer.height);
    this.prefilter.uniforms.tSrc.value = readBuffer.texture;
    this.blit(renderer, this.prefilter, this.down[0]);

    let last = this.down[0];
    for (let i = 1; i < this.mipCount; i++) {
      this.blurH.uniforms.tSrc.value = last.texture;
      this.blurH.uniforms.uTexel.value.set(2 / last.width, 2 / last.height);
      this.blit(renderer, this.blurH, this.up[i]);
      this.blurV.uniforms.tSrc.value = this.up[i].texture;
      this.blurV.uniforms.uTexel.value.set(1 / this.up[i].width, 1 / this.up[i].height);
      this.blit(renderer, this.blurV, this.down[i]);
      last = this.down[i];
    }
    for (let i = this.mipCount - 2; i >= 0; i--) {
      const low = i === this.mipCount - 2 ? this.down[i + 1] : this.up[i + 1];
      this.upsample.uniforms.tSrc.value = this.down[i].texture;
      this.upsample.uniforms.tLow.value = low.texture;
      this.blit(renderer, this.upsample, this.up[i]);
    }
    const bloom = this.mipCount > 1 ? this.up[0] : this.down[0];

    // Panini parameters (CalcViewExtents / CalcCropExtents)
    const d = PANINI.distance;
    const ey = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5);
    const ex = (readBuffer.width / readBuffer.height) * ey;
    // CalcCropExtents takes ONE hypotenuse, from the x extent, for both axes, so both scales are equal.
    const cylDistMinusD = 1 / Math.sqrt(ex * ex + 1);
    const scaleF = cylDistMinusD * ((1 + d) / (cylDistMinusD + d));
    const s = THREE.MathUtils.lerp(1, THREE.MathUtils.clamp(scaleF, 0, 1), PANINI.cropToFit);
    this.composite.uniforms.uPanini.value.set(ex, ey, d, s);

    this.composite.uniforms.tSrc.value = readBuffer.texture;
    this.composite.uniforms.tBloom.value = bloom.texture;
    this.blit(renderer, this.composite, this.renderToScreen ? null : writeBuffer);
  }

  dispose(): void {
    for (const t of [...this.down, ...this.up]) t.dispose();
    for (const m of [this.prefilter, this.blurH, this.blurV, this.upsample, this.composite]) m.dispose();
    this.quad.dispose();
  }
}
