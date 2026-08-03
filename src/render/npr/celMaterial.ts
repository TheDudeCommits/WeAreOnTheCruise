import {
  Color,
  DoubleSide,
  FrontSide,
  ShaderMaterial,
  Vector3,
  type ColorRepresentation,
  type Side,
} from 'three';

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
}

const celVertexShader = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vCelColor;

uniform vec3 uBaseColor;

void main() {
  vec3 objectPosition = position;
  vec3 objectNormal = normal;

  #ifdef USE_INSTANCING
    objectPosition = (instanceMatrix * vec4(objectPosition, 1.0)).xyz;
    objectNormal = mat3(instanceMatrix) * objectNormal;
  #endif

  vec4 worldPosition = modelMatrix * vec4(objectPosition, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  vCelColor = uBaseColor;

  #ifdef USE_COLOR
    vCelColor *= color;
  #endif

  #ifdef USE_INSTANCING_COLOR
    vCelColor *= instanceColor;
  #endif

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const celFragmentShader = /* glsl */ `
precision highp float;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vCelColor;

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
  vec3 halfDirection = normalize(lightDirection + viewDirection);
  float hardSpecular = step(uSpecularThreshold, max(0.0, dot(normal, halfDirection)));
  hardSpecular *= step(uBandThresholds.y, diffuse);
  color = mix(color, uSpecularColor, hardSpecular * 0.48);

  float rim = 1.0 - max(0.0, dot(normal, viewDirection));
  rim = step(uRimThreshold, rim) * uRimStrength;
  color = mix(color, uRimColor, clamp(rim, 0.0, 0.75));

  float fog = clamp((distance(cameraPosition, vWorldPosition) - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  fog = floor(fog * 4.0) * 0.25;
  color = mix(color, uHorizonColor, fog);

  gl_FragColor = vec4(color, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class CelMaterial extends ShaderMaterial {
  constructor(options: CelMaterialOptions = {}) {
    const thresholds = options.bandThresholds ?? [0.34, 0.58, 0.82];
    super({
      name: options.name ?? 'CelMaterial',
      vertexShader: celVertexShader,
      fragmentShader: celFragmentShader,
      uniforms: {
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
      },
      transparent: (options.opacity ?? 1) < 1,
      depthWrite: (options.opacity ?? 1) >= 1,
      side: options.side ?? FrontSide,
      vertexColors: options.vertexColors ?? false,
      defines: options.flatShading ? { FLAT_SHADED_CEL: '' } : undefined,
    });
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
