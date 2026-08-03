import {
  BackSide,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Vec3, WeatherKind } from '../../core/contracts';
import { createCelMaterial } from '../npr/celMaterial';

const skyVertexShader = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const skyFragmentShader = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uStorm;
uniform float uNight;
uniform vec3 uSunDirection;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uLowerBand;
varying vec3 vDirection;

void main() {
  vec3 direction = normalize(vDirection);
  float height = direction.y * 0.5 + 0.5;
  vec3 sky = uLowerBand;
  if (height > 0.42) sky = uHorizon;
  if (height > 0.58) sky = mix(uHorizon, uZenith, 0.55);
  if (height > 0.76) sky = uZenith;

  float sunDot = dot(direction, normalize(uSunDirection));
  float sunDisc = step(0.99855, sunDot);
  float halo = step(0.986, sunDot) * (1.0 - sunDisc);
  float flareRing = step(0.972, sunDot) * (1.0 - step(0.978, sunDot));
  vec3 sunColor = mix(vec3(1.0, 0.55, 0.14), vec3(1.0, 0.96, 0.68), sunDisc);
  sky = mix(sky, sunColor, sunDisc);
  sky = mix(sky, vec3(1.0, 0.72, 0.32), halo * 0.35 + flareRing * 0.12);

  float horizonStripe = step(0.485, height) * (1.0 - step(0.505, height));
  sky = mix(sky, vec3(1.0, 0.72, 0.42), horizonStripe * (1.0 - uStorm) * (1.0 - uNight));
  sky = mix(sky, vec3(0.12, 0.16, 0.28), uStorm * 0.72);
  sky = mix(sky, vec3(0.018, 0.035, 0.12), uNight * 0.88);
  gl_FragColor = vec4(sky, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class ProceduralSky {
  readonly group = new Group();
  private readonly skyGeometry = new SphereGeometry(2_650, 32, 16);
  private readonly skyMaterial: ShaderMaterial;
  private readonly cloudGeometry = new IcosahedronGeometry(1, 1);
  private readonly cloudMaterial = createCelMaterial({
    color: 0xfff6df,
    shadowTint: 0xc3cbd0,
    highlightTint: 0xffffff,
    rimColor: 0xfff8e2,
    rimStrength: 0.45,
    fogNear: 1_500,
    fogFar: 3_000,
    vertexColors: true,
  });
  private readonly clouds: InstancedMesh;

  constructor(seed = 1) {
    this.skyMaterial = new ShaderMaterial({
      name: 'ProceduralGraphicSky',
      vertexShader: skyVertexShader,
      fragmentShader: skyFragmentShader,
      side: BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uStorm: { value: 0 },
        uNight: { value: 0 },
        uSunDirection: { value: new Vector3(-0.5, 0.53, -0.68).normalize() },
        uZenith: { value: new Color(0x168ed0) },
        uHorizon: { value: new Color(0x83dce5) },
        uLowerBand: { value: new Color(0xf3bb75) },
      },
    });
    const dome = new Mesh(this.skyGeometry, this.skyMaterial);
    dome.frustumCulled = false;
    dome.renderOrder = -100;

    this.clouds = new InstancedMesh(this.cloudGeometry, this.cloudMaterial, 46);
    const matrix = new Matrix4();
    const color = new Color();
    for (let index = 0; index < 46; index += 1) {
      const angle = pseudo(seed + index * 17) * Math.PI * 2;
      const radius = 380 + pseudo(seed + index * 31) * 1_330;
      const altitude = index % 3 === 0 ? 260 : 145 + pseudo(seed + index * 47) * 105;
      const scaleX = 28 + pseudo(seed + index * 61) * 78;
      const scaleY = 7 + pseudo(seed + index * 73) * 12;
      const scaleZ = 24 + pseudo(seed + index * 89) * 68;
      matrix.compose(
        new Vector3(Math.sin(angle) * radius, altitude, Math.cos(angle) * radius),
        new Quaternion(),
        new Vector3(scaleX, scaleY, scaleZ),
      );
      this.clouds.setMatrixAt(index, matrix);
      this.clouds.setColorAt(index, color.set(index % 3 === 0 ? 0xd9e7ef : 0xfff5dc));
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    if (this.clouds.instanceColor) this.clouds.instanceColor.needsUpdate = true;
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -40;
    this.group.name = 'ProceduralSkyAndClouds';
    this.group.add(dome, this.clouds);
  }

  update(time: number, focus: Vec3, weather: WeatherKind): void {
    this.skyMaterial.uniforms.uTime!.value = time;
    this.skyMaterial.uniforms.uStorm!.value = weather === 'storm' || weather === 'maelstrom' ? 1 : 0;
    this.skyMaterial.uniforms.uNight!.value = weather === 'night' ? 1 : 0;
    this.group.position.set(focus.x, 0, focus.z);
    this.clouds.rotation.y = time * 0.0028;
    this.clouds.visible = weather !== 'fog';
  }

  dispose(): void {
    this.group.removeFromParent();
    this.skyGeometry.dispose();
    this.skyMaterial.dispose();
    this.cloudGeometry.dispose();
    this.cloudMaterial.dispose();
  }
}

function pseudo(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43_758.5453;
  return value - Math.floor(value);
}
