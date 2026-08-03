import {
  BackSide,
  Color,
  Mesh,
  Object3D,
  ShaderMaterial,
  Vector2,
  type BufferGeometry,
  type ColorRepresentation,
  type Material,
} from 'three';

export interface InvertedHullOptions {
  color?: ColorRepresentation;
  thicknessPixels?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  renderOrderOffset?: number;
  name?: string;
}

const outlineVertexShader = /* glsl */ `
uniform vec2 uViewport;
uniform float uThicknessPixels;

void main() {
  vec3 objectPosition = position;
  vec3 objectNormal = normal;

  #ifdef USE_INSTANCING
    objectPosition = (instanceMatrix * vec4(objectPosition, 1.0)).xyz;
    objectNormal = mat3(instanceMatrix) * objectNormal;
  #endif

  vec4 viewPosition = modelViewMatrix * vec4(objectPosition, 1.0);
  vec3 viewNormal = normalize(normalMatrix * objectNormal);
  vec4 clipPosition = projectionMatrix * viewPosition;
  vec2 projectedNormal = (projectionMatrix * vec4(viewNormal, 0.0)).xy;
  float normalLength = max(0.0001, length(projectedNormal));
  vec2 pixelToNdc = vec2(2.0) / max(vec2(1.0), uViewport);
  clipPosition.xy += (projectedNormal / normalLength) * pixelToNdc * uThicknessPixels * clipPosition.w;
  gl_Position = clipPosition;
}
`;

const outlineFragmentShader = /* glsl */ `
precision highp float;
uniform vec3 uInkColor;

void main() {
  gl_FragColor = vec4(uInkColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createOutlineMaterial(options: InvertedHullOptions = {}): ShaderMaterial {
  const material = new ShaderMaterial({
    name: options.name ?? 'InvertedHullInk',
    vertexShader: outlineVertexShader,
    fragmentShader: outlineFragmentShader,
    uniforms: {
      uInkColor: { value: new Color(options.color ?? 0x10162c) },
      uThicknessPixels: { value: options.thicknessPixels ?? 2.25 },
      uViewport: { value: new Vector2(options.viewportWidth ?? 1_920, options.viewportHeight ?? 1_080) },
    },
    side: BackSide,
    depthWrite: false,
  });
  material.userData.isInvertedHullOutline = true;
  return material;
}

/**
 * Creates a screen-constant silhouette shell. Add it as a child of the source
 * mesh; sharing geometry keeps the helper cheap and ensures deformation parity.
 */
export function attachInvertedHullOutline(
  source: Mesh<BufferGeometry, Material | Material[]>,
  options: InvertedHullOptions = {},
): Mesh<BufferGeometry, ShaderMaterial> {
  const outline = new Mesh(source.geometry, createOutlineMaterial(options));
  outline.name = options.name ?? `${source.name || 'mesh'}-ink-outline`;
  outline.frustumCulled = source.frustumCulled;
  outline.renderOrder = source.renderOrder + (options.renderOrderOffset ?? -1);
  outline.userData.isInvertedHullOutline = true;
  source.add(outline);
  return outline;
}

export function setOutlineViewport(root: Object3D, width: number, height: number): void {
  root.traverse((object) => {
    const material = (object as Mesh).material;
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const candidate of materials) {
      if (!(candidate instanceof ShaderMaterial) || candidate.userData.isInvertedHullOutline !== true) continue;
      (candidate.uniforms.uViewport?.value as Vector2).set(Math.max(1, width), Math.max(1, height));
    }
  });
}
