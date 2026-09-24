/**
 * Rain (LOOK-owned): wind-slanted streaks in a volume that wraps around the camera, animated entirely on the GPU
 * (no per-frame CPU work beyond a few uniforms). Each streak is a thin quad stretched along its velocity and turned
 * to face the camera, so it reads as a streak from the tactical camera above as well as from the low showcase angle.
 */
import * as THREE from 'three';

const VERTEX = /* glsl */ `
attribute vec4 aDrop; // xyz: 0..1 position in the volume, w: random
uniform vec3 uOrigin;
uniform vec3 uBox;
uniform float uTime;
uniform vec3 uVelocity;
uniform float uLength;
uniform float uWidth;
varying float vAlpha;
varying float vAlong;
void main() {
	vec3 p = aDrop.xyz * uBox + uVelocity * uTime * ( 0.85 + 0.3 * aDrop.w );
	vec3 world = uOrigin - uBox * 0.5 + mod( p - uOrigin + uBox * 0.5, uBox );
	vec3 dir = normalize( uVelocity );
	vec3 toCam = normalize( cameraPosition - world );
	vec3 side = normalize( cross( dir, toCam ) );
	float along = position.y + 0.5;
	world += dir * ( along - 0.5 ) * uLength * ( 0.7 + 0.6 * aDrop.w ) + side * position.x * uWidth;
	vAlong = along;
	float dist = length( cameraPosition - world );
	vAlpha = smoothstep( 4.0, 18.0, dist ) * ( 1.0 - smoothstep( uBox.x * 0.35, uBox.x * 0.5, length( world.xz - uOrigin.xz ) ) );
	gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying float vAlong;
void main() {
	float a = vAlpha * uOpacity * smoothstep( 0.0, 0.35, vAlong ) * ( 0.55 + 0.45 * vAlong );
	if ( a < 0.004 ) discard;
	gl_FragColor = vec4( uColor, a );
}
`;

export class RainField {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  readonly uniforms = {
    uOrigin: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(170, 150, 170) },
    uTime: { value: 0 },
    uVelocity: { value: new THREE.Vector3(6, -42, 3) },
    uLength: { value: 5.5 },
    uWidth: { value: 0.14 },
    uColor: { value: new THREE.Color(0.82, 0.9, 0.96) },
    uOpacity: { value: 0 },
  };
  readonly max: number;

  constructor(max = 5000) {
    this.max = max;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const drops = new Float32Array(max * 4);
    let s = 424242;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < max * 4; i++) drops[i] = rnd();
    geometry.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drops, 4));
    this.material = new THREE.ShaderMaterial({
      name: 'sky-rain', vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: this.uniforms,
      transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, max);
    this.mesh.name = 'sky-rain';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 10;
    this.mesh.userData.inkSkip = true;
    this.mesh.userData.lookInternal = true;
    this.mesh.raycast = () => undefined;
  }

  update(time: number, intensity: number, origin: THREE.Vector3, windX: number, windZ: number, windStrength: number, density: number, color: THREE.Color): void {
    // 60% of the pool at full storm: enough to read as a downpour without hiding the fight.
    const count = Math.round(this.max * 0.6 * THREE.MathUtils.clamp(intensity, 0, 1) * density);
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    if (!count) return;
    const u = this.uniforms;
    u.uTime.value = time % 1000;
    u.uOrigin.value.copy(origin);
    const push = 6 + 14 * windStrength;
    u.uVelocity.value.set(windX * push, -44, windZ * push);
    u.uOpacity.value = 0.22 + 0.2 * intensity;
    u.uColor.value.copy(color);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
