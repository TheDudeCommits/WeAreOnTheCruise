/**
 * Sky dome (LOOK-owned): camera-centred, drawn at the far plane before everything else.
 * Painted gradient (zenith → horizon → haze band), HDR sun disc with a warm glow (blooms), a large crescent moon with
 * a halo, twinkling stars, a rolling storm overcast lit from inside by lightning, and pearl fog.
 */
import * as THREE from 'three';
import { atmosphereUniforms } from '../materials/atmosphere';

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
	vDir = position;
	vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position * 100.0, 1.0 );
	gl_Position = p.xyww;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunVisible;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform float uMoonVisible;
uniform float uStars;
uniform float uStorm;
uniform float uFog;
uniform float uTime;
uniform float uFlash;
uniform vec3 uFlashDir;
uniform vec3 uOvercastLit;
uniform vec3 uOvercastShade;
uniform sampler2D uCruiseNoise;
varying vec3 vDir;

float hash13( vec3 p3 ) {
	p3 = fract( p3 * 0.1031 );
	p3 += dot( p3, p3.zyx + 31.32 );
	return fract( ( p3.x + p3.y ) * p3.z );
}

float disc( vec3 d, vec3 c, float radius ) {
	float x = dot( d, c );
	float r = cos( radius );
	float aa = fwidth( x ) * 1.2 + 1e-6;
	return smoothstep( r - aa, r + aa, x );
}

void main() {
	vec3 d = normalize( vDir );
	float h = d.y;
	float up = clamp( h, 0.0, 1.0 );
	vec3 sky = mix( uHorizon, uZenith, pow( up, 0.42 ) );
	float band = exp( -max( h, 0.0 ) * 11.0 );
	sky = mix( sky, uHaze, band * 0.9 );

	// Warm scattering around the sun (also tints the horizon on that side).
	float sd = max( dot( d, uSunDir ), 0.0 );
	float horizonSide = exp( -max( h, 0.0 ) * 4.0 );
	sky += uSunColor * ( pow( sd, 6.0 ) * ( 0.22 + 0.35 * horizonSide ) + pow( sd, 48.0 ) * 0.45 ) * uSunVisible * ( 1.0 - uStorm * 0.85 );

	// Stars.
	if ( uStars > 0.01 && h > 0.0 ) {
		vec3 p = d * 160.0;
		vec3 cell = floor( p );
		float rnd = hash13( cell );
		if ( rnd > 0.985 ) {
			vec3 centre = cell + 0.5 + ( vec3( hash13( cell + 1.3 ), hash13( cell + 2.7 ), hash13( cell + 4.1 ) ) - 0.5 ) * 0.6;
			float dist = length( p - centre );
			float size = 0.06 + ( rnd - 0.985 ) * 9.0;
			float twinkle = 0.65 + 0.35 * sin( uTime * ( 1.5 + rnd * 4.0 ) + rnd * 60.0 );
			float star = smoothstep( size, size * 0.3, dist ) * twinkle;
			sky += vec3( 0.85, 0.9, 1.0 ) * star * uStars * smoothstep( 0.02, 0.2, h ) * 2.2;
		}
	}

	// Moon: big crescent with a soft halo; the dark side keeps a faint earthshine.
	if ( uMoonVisible > 0.01 ) {
		float md = max( dot( d, uMoonDir ), 0.0 );
		sky += uMoonColor * ( pow( md, 180.0 ) * 0.5 + pow( md, 22.0 ) * 0.12 ) * uMoonVisible;
		vec3 side = normalize( cross( uMoonDir, vec3( 0.0, 1.0, 0.0 ) ) );
		vec3 shadowC = normalize( uMoonDir + ( side * 0.55 + vec3( 0.0, 0.42, 0.0 ) ) * 0.062 );
		float body = disc( d, uMoonDir, 0.075 );
		float bite = disc( d, shadowC, 0.07 );
		float crescent = body * ( 1.0 - bite );
		sky = mix( sky, sky * 0.7 + uMoonColor * 0.05, body * bite * uMoonVisible );
		sky = mix( sky, uMoonColor * 3.2, crescent * uMoonVisible );
	}

	// Sun disc (HDR so it blooms).
	float sunDisc = disc( d, uSunDir, 0.028 );
	sky = mix( sky, uSunColor * 7.0, sunDisc * uSunVisible * ( 1.0 - uStorm ) );

	// Storm overcast: rolling cel-banded cloud deck, lit from within by lightning.
	if ( uStorm > 0.01 ) {
		vec2 q = d.xz / ( max( h, 0.0 ) + 0.18 );
		vec2 flow = vec2( uTime * 0.012, uTime * 0.004 );
		float n = texture2D( uCruiseNoise, q * 0.16 + flow ).r * 0.65 + texture2D( uCruiseNoise, q * 0.42 - flow * 1.7 ).r * 0.35;
		float bands = smoothstep( 0.42, 0.46, n ) * 0.55 + smoothstep( 0.58, 0.62, n ) * 0.45;
		vec3 deck = mix( uOvercastShade, uOvercastLit, bands );
		float flashNear = pow( max( dot( d, uFlashDir ), 0.0 ), 5.0 );
		deck += vec3( 0.75, 0.85, 1.0 ) * uFlash * ( 0.35 + 1.6 * flashNear ) * ( 0.4 + bands );
		float cover = smoothstep( -0.02, 0.08, h ) * uStorm;
		sky = mix( sky, deck, cover );
	}

	// Pearl fog swallows the sky toward the horizon.
	sky = mix( sky, uHaze, uFog * ( 1.0 - smoothstep( 0.05, 0.55, h ) * 0.55 ) );
	// Below the horizon: haze (the ocean's far edge fades into it).
	sky = mix( uHaze, sky, smoothstep( -0.03, 0.0, h ) );
	gl_FragColor = vec4( sky, 1.0 );
}
`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSunVisible: { value: 1 },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonColor: { value: new THREE.Color(0.8, 0.88, 1.0) },
    uMoonVisible: { value: 0 },
    uStars: { value: 0 },
    uStorm: { value: 0 },
    uFog: { value: 0 },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uFlashDir: { value: new THREE.Vector3(1, 0.3, 0).normalize() },
    uOvercastLit: { value: new THREE.Color() },
    uOvercastShade: { value: new THREE.Color() },
    uCruiseNoise: atmosphereUniforms.uCruiseNoise,
  };

  constructor() {
    this.material = new THREE.ShaderMaterial({
      name: 'sky-dome', vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.material);
    this.mesh.name = 'sky-dome';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.userData.inkSkip = true;
    this.mesh.userData.lookInternal = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
