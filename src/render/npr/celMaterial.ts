import {
  Color,
  DoubleSide,
  FrontSide,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type ColorRepresentation,
  type Side,
  type Texture,
} from 'three';
import type { AtmospherePalette } from '../world/Atmosphere';

export interface CelMaterialOptions {
  color?: ColorRepresentation;
  lightDirection?: Vector3;
  shadowTint?: ColorRepresentation;
  highlightTint?: ColorRepresentation;
  rimColor?: ColorRepresentation;
  rimStrength?: number;
  rimThreshold?: number;
  specularColor?: ColorRepresentation;
  specularThreshold?: number;
  bandThresholds?: readonly [number, number, number];
  horizonColor?: ColorRepresentation;
  fogNear?: number;
  fogFar?: number;
  opacity?: number;
  side?: Side;
  flatShading?: boolean;
  vertexColors?: boolean;
  name?: string;
  surfaceMap?: Texture;
  surfaceScale?: number;
  surfaceStrength?: number;
  cloth?: boolean;
  strata?: boolean;
}

const celVertexShader = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vCelColor;
varying vec3 vSurfacePosition;
varying vec3 vSurfaceNormal;

uniform vec3 uBaseColor;

void main() {
  vec3 objectPosition = position;
  vec3 objectNormal = normal;
  vSurfacePosition = position;
  vSurfaceNormal = normal;

  #ifdef USE_INSTANCING
    objectPosition = (instanceMatrix * vec4(objectPosition, 1.0)).xyz;
    mat3 im = mat3(instanceMatrix);
    objectNormal /= vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
    objectNormal = im * objectNormal;
  #endif

  vec4 worldPosition = modelMatrix * vec4(objectPosition, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(vec3(vec4(normalMatrix * objectNormal, 0.0) * viewMatrix));
  vCelColor = uBaseColor;

  #ifdef USE_COLOR
    vCelColor *= color;
  #endif

  #ifdef USE_INSTANCING_COLOR
    vCelColor *= instanceColor;
  #endif

  vec3 transformedNormal = normalMatrix * objectNormal;
  #include <shadowmap_vertex>
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const celFragmentShader = /* glsl */ `
precision highp float;
#include <common>
#include <packing>
uniform bool receiveShadow;
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vCelColor;
varying vec3 vSurfacePosition;
varying vec3 vSurfaceNormal;

uniform vec3 uLightDirection;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform vec3 uRimColor;
uniform vec3 uSpecularColor;
uniform vec3 uHorizonColor;
uniform vec3 uBandThresholds;
uniform float uRimStrength;
uniform float uRimThreshold;
uniform float uSpecularThreshold;
uniform float uFogNear;
uniform float uFogFar;
uniform float uOpacity;
uniform vec3 uAtmosphereTint;
uniform sampler2D uSurfaceMap;
uniform float uSurfaceScale;
uniform float uSurfaceStrength;
uniform float uCloth;
uniform float uStrata;

void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 lightDirection = normalize(uLightDirection);
  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  float diffuse = dot(normal, lightDirection) * 0.5 + 0.5;

  vec3 shade = uShadowTint;
  if (diffuse > uBandThresholds.x) shade = mix(uShadowTint, vec3(1.0), 0.42);
  if (diffuse > uBandThresholds.y) shade = vec3(1.0);
  if (diffuse > uBandThresholds.z) shade = uHighlightTint;

  vec3 color = vCelColor * shade;
  if (uSurfaceStrength > 0.001) {
    vec3 weights = pow(abs(normalize(vSurfaceNormal)), vec3(4.0));
    weights /= max(.001, weights.x + weights.y + weights.z);
    vec3 p = vSurfacePosition * uSurfaceScale;
    vec3 paint = texture2D(uSurfaceMap, p.zy).rgb * weights.x;
    paint += texture2D(uSurfaceMap, p.xz).rgb * weights.y;
    paint += texture2D(uSurfaceMap, p.xy).rgb * weights.z;
    color *= mix(vec3(1.0), clamp(paint * 1.65, vec3(.22), vec3(1.28)), uSurfaceStrength);
  }
  if (uCloth > 0.5) {
    float seam = 1.0 - smoothstep(0.008, 0.018, abs(fract(vSurfacePosition.x * .27) - .5));
    float weave = sin(vSurfacePosition.x * 73.0) * sin(vSurfacePosition.y * 81.0);
    color *= 1.0 - seam * .10 + weave * .018;
  }
  if (uStrata > 0.5 && normal.y < .68) {
    // Mineral seams run through the volume, including arch undersides. They
    // stay in world space when separately authored cliff pieces are merged.
    vec3 p=vWorldPosition;
    float strata=sin(p.y*.44+sin(p.x*.037+p.z*.029)*1.4);
    float seam=1.-smoothstep(.035,.11,abs(strata-.86));
    float fissure=1.-smoothstep(.015,.065,abs(sin(p.x*.19+p.z*.17+sin(p.y*.048)*.7)));
    float mineral=sin(p.x*.043+p.z*.066+p.y*.018)*.5+.5;
    color*=1.-seam*.17-fissure*.12;
    color=mix(color,color*vec3(.69,.81,.89),mineral*.16);
  }
  color *= mix(vec3(.55,.59,.73), vec3(1.0), getShadowMask());
  vec3 halfDirection = normalize(lightDirection + viewDirection);
  float hardSpecular = step(uSpecularThreshold, max(0.0, dot(normal, halfDirection)));
  hardSpecular *= step(uBandThresholds.y, diffuse);
  color = mix(color, uSpecularColor, hardSpecular * 0.13);

  float rim = 1.0 - max(0.0, dot(normal, viewDirection));
  rim = smoothstep(uRimThreshold, min(1.0, uRimThreshold + 0.12), rim) * uRimStrength;
  color = mix(color, uRimColor, clamp(rim, 0.0, 0.75));

  float fog = clamp((distance(cameraPosition, vWorldPosition) - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  color *= uAtmosphereTint;
  color = mix(color, uHorizonColor, fog * fog * (3.0 - 2.0 * fog));

  gl_FragColor = vec4(color, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class CelMaterial extends ShaderMaterial {
  static readonly live = new Set<CelMaterial>();
  constructor(options: CelMaterialOptions = {}) {
    const thresholds = options.bandThresholds ?? [0.34, 0.58, 0.82];
    super({
      name: options.name ?? 'CelMaterial',
      vertexShader: celVertexShader,
      fragmentShader: celFragmentShader,
      lights: true,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.lights),
        uBaseColor: { value: new Color(options.color ?? 0xffffff) },
        uLightDirection: { value: (options.lightDirection ?? new Vector3(-0.45, 0.82, 0.35)).clone().normalize() },
        uShadowTint: { value: new Color(options.shadowTint ?? 0x405078) },
        uHighlightTint: { value: new Color(options.highlightTint ?? 0xfff2bc) },
        uRimColor: { value: new Color(options.rimColor ?? 0x9beaff) },
        uSpecularColor: { value: new Color(options.specularColor ?? 0xfff3c4) },
        uHorizonColor: { value: new Color(options.horizonColor ?? 0x7fd8e8) },
        uBandThresholds: { value: new Vector3(thresholds[0], thresholds[1], thresholds[2]) },
        uRimStrength: { value: options.rimStrength ?? 0.26 },
        uRimThreshold: { value: options.rimThreshold ?? 0.64 },
        uSpecularThreshold: { value: options.specularThreshold ?? 0.92 },
        uFogNear: { value: options.fogNear ?? 580 },
        uFogFar: { value: options.fogFar ?? 2_300 },
        uOpacity: { value: options.opacity ?? 1 },
        uAtmosphereTint: { value: new Color(1, 1, 1) },
        uSurfaceMap: { value: options.surfaceMap ?? null },
        uSurfaceScale: { value: options.surfaceScale ?? .03 },
        uSurfaceStrength: { value: options.surfaceMap ? options.surfaceStrength ?? .6 : 0 },
        uCloth: { value: options.cloth ? 1 : 0 },
        uStrata: { value: options.strata ? 1 : 0 },
      },
      transparent: (options.opacity ?? 1) < 1,
      depthWrite: (options.opacity ?? 1) >= 1,
      side: options.side ?? FrontSide,
      vertexColors: options.vertexColors ?? false,
      defines: options.flatShading ? { FLAT_SHADED_CEL: '' } : {},
    });
    CelMaterial.live.add(this);
  }

  override dispose(): void { CelMaterial.live.delete(this); super.dispose(); }

  static applyAtmosphere(palette: AtmospherePalette): void {
    for (const material of CelMaterial.live) {
      (material.uniforms.uHorizonColor!.value as Color).setHex(palette.horizon);
      (material.uniforms.uAtmosphereTint!.value as Color).setRGB(palette.exposure, palette.exposure, Math.min(1, palette.exposure + 0.07));
      if(!material.userData.preserveFog){material.uniforms.uFogNear!.value = palette.fogNear;
      material.uniforms.uFogFar!.value = palette.fogFar;}
    }
  }

  setColor(color: ColorRepresentation): this {
    (this.uniforms.uBaseColor?.value as Color).set(color);
    return this;
  }

  setLightDirection(direction: Vector3): this {
    (this.uniforms.uLightDirection?.value as Vector3).copy(direction).normalize();
    return this;
  }
}

export function createCelMaterial(options: CelMaterialOptions = {}): CelMaterial {
  return new CelMaterial(options);
}

export function createDoubleSidedCelMaterial(options: CelMaterialOptions = {}): CelMaterial {
  return new CelMaterial({ ...options, side: DoubleSide });
}
