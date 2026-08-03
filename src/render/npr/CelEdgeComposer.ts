import {
  Color,
  DepthTexture,
  HalfFloatType,
  MeshNormalMaterial,
  NearestFilter,
  NoBlending,
  ShaderMaterial,
  UnsignedIntType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type ColorRepresentation,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export interface CelEdgeComposerOptions {
  width?: number;
  height?: number;
  lineColor?: ColorRepresentation;
  lineOpacity?: number;
  depthSensitivity?: number;
  normalSensitivity?: number;
  colorSensitivity?: number;
}

const edgeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    tNormal: { value: null },
    uTexel: { value: new Vector2(1, 1) },
    uLineColor: { value: new Color(0x10162c) },
    uLineOpacity: { value: 0.84 },
    uDepthSensitivity: { value: 42 },
    uNormalSensitivity: { value: 1.65 },
    uColorSensitivity: { value: 0.85 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform sampler2D tNormal;
    uniform vec2 uTexel;
    uniform vec3 uLineColor;
    uniform float uLineOpacity;
    uniform float uDepthSensitivity;
    uniform float uNormalSensitivity;
    uniform float uColorSensitivity;
    varying vec2 vUv;

    float luma(vec3 color) {
      return dot(color, vec3(0.2126, 0.7152, 0.0722));
    }

    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      float centerDepth = texture2D(tDepth, vUv).x;
      vec3 centerNormal = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
      float centerLuma = luma(source.rgb);
      float depthEdge = 0.0;
      float normalEdge = 0.0;
      float colorEdge = 0.0;

      for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
          if (x == 0 && y == 0) continue;
          vec2 offset = vec2(float(x), float(y)) * uTexel;
          float sampleDepth = texture2D(tDepth, vUv + offset).x;
          vec3 sampleNormal = texture2D(tNormal, vUv + offset).xyz * 2.0 - 1.0;
          float sampleLuma = luma(texture2D(tDiffuse, vUv + offset).rgb);
          depthEdge = max(depthEdge, abs(centerDepth - sampleDepth));
          normalEdge = max(normalEdge, length(centerNormal - sampleNormal));
          colorEdge = max(colorEdge, abs(centerLuma - sampleLuma));
        }
      }

      float signal = max(depthEdge * uDepthSensitivity, normalEdge * uNormalSensitivity);
      signal = max(signal, colorEdge * uColorSensitivity);
      float edge = smoothstep(0.16, 0.34, signal) * uLineOpacity;
      gl_FragColor = vec4(mix(source.rgb, uLineColor, edge), source.a);
    }
  `,
};

/** Optional two-pass normal/depth Sobel adapter. Call render() instead of renderer.render(). */
export class CelEdgeComposer {
  readonly composer: EffectComposer;
  enabled = true;

  private readonly normalTarget: WebGLRenderTarget;
  private readonly normalMaterial = new MeshNormalMaterial({ blending: NoBlending });
  private readonly edgePass: ShaderPass;
  private width: number;
  private height: number;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: Camera,
    options: CelEdgeComposerOptions = {},
  ) {
    this.width = Math.max(1, options.width ?? 1_280);
    this.height = Math.max(1, options.height ?? 720);
    const colorTarget = new WebGLRenderTarget(this.width, this.height, {
      type: HalfFloatType,
      depthBuffer: true,
      magFilter: NearestFilter,
      minFilter: NearestFilter,
    });
    colorTarget.depthTexture = new DepthTexture(this.width, this.height, UnsignedIntType);
    this.composer = new EffectComposer(renderer, colorTarget);
    this.composer.addPass(new RenderPass(scene, camera));

    this.normalTarget = new WebGLRenderTarget(this.width, this.height, {
      depthBuffer: true,
      magFilter: NearestFilter,
      minFilter: NearestFilter,
    });
    const material = new ShaderMaterial(edgeShader);
    material.uniforms.uLineColor?.value.set(options.lineColor ?? 0x10162c);
    material.uniforms.uLineOpacity!.value = options.lineOpacity ?? 0.84;
    material.uniforms.uDepthSensitivity!.value = options.depthSensitivity ?? 42;
    material.uniforms.uNormalSensitivity!.value = options.normalSensitivity ?? 1.65;
    material.uniforms.uColorSensitivity!.value = options.colorSensitivity ?? 0.85;
    material.uniforms.tNormal!.value = this.normalTarget.texture;
    this.edgePass = new ShaderPass(material);
    this.composer.addPass(this.edgePass);
    this.setSize(this.width, this.height);
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.composer.setSize(this.width, this.height);
    this.normalTarget.setSize(this.width, this.height);
    (this.edgePass.material.uniforms.uTexel?.value as Vector2).set(1 / this.width, 1 / this.height);
  }

  render(deltaTime = 0): void {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const previousTarget = this.renderer.getRenderTarget();
    const previousOverride = this.scene.overrideMaterial;
    this.scene.overrideMaterial = this.normalMaterial;
    this.renderer.setRenderTarget(this.normalTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = previousOverride;
    this.renderer.setRenderTarget(previousTarget);

    const depthTexture = this.composer.readBuffer.depthTexture;
    this.edgePass.material.uniforms.tDepth!.value = depthTexture;
    this.composer.render(deltaTime);
  }

  dispose(): void {
    this.normalMaterial.dispose();
    this.normalTarget.dispose();
    (this.edgePass.material as ShaderMaterial).dispose();
    this.composer.dispose();
  }
}
