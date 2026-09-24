/**
 * Anime cumulus (LOOK-owned): procedural cel cloud cards in three parallax rings around the focus.
 * Each card is an upright, camera-facing quad whose fragment shader builds a cauliflower silhouette from three rows of
 * overlapping puffs over a flat base, shades every puff as a sphere (lit/shadow bands per lobe, a darker base and a
 * silver lining toward the sun), and fades into the horizon haze with distance. One instanced draw.
 */
import * as THREE from 'three';
import { atmosphereUniforms } from '../materials/atmosphere';

const VERTEX = /* glsl */ `
attribute float aSeed;
uniform vec3 uSunDir;
varying vec2 vUv;
varying float vSeed;
varying float vAspect;
varying vec3 vSunCard;
varying float vDist;
varying float vElevation;
void main() {
	vec3 centre = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
	float w = length( instanceMatrix[ 0 ].xyz );
	float h = length( instanceMatrix[ 1 ].xyz );
	vec3 toCam = cameraPosition - centre;
	vec3 flat_ = vec3( toCam.x, 0.0, toCam.z );
	vec3 fwd = length( flat_ ) > 1e-3 ? normalize( flat_ ) : vec3( 0.0, 0.0, 1.0 );
	vec3 right = normalize( cross( vec3( 0.0, 1.0, 0.0 ), fwd ) );
	vec3 world = centre + right * position.x * w + vec3( 0.0, 1.0, 0.0 ) * ( position.y + 0.5 ) * h;
	vUv = position.xy + 0.5;
	vSeed = aSeed;
	vAspect = w / max( h, 1.0 );
	vSunCard = vec3( dot( uSunDir, right ), dot( uSunDir, vec3( 0.0, 1.0, 0.0 ) ), dot( uSunDir, fwd ) );
	vDist = length( toCam );
	vElevation = ( world.y - cameraPosition.y ) / max( length( world - cameraPosition ), 1.0 );
	gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uHaze;
uniform vec3 uRimColor;
uniform float uFade;
uniform float uFlash;
uniform float uOpacity;
uniform sampler2D uCruiseNoise;
varying vec2 vUv;
varying float vSeed;
varying float vAspect;
varying vec3 vSunCard;
varying float vDist;
varying float vElevation;

float h11( float n ) { return fract( sin( n * 127.1 + 311.7 ) * 43758.5453 ); }

void main() {
	vec2 p = vUv;
	float shape = -1.0;
	// Smooth-max heightfield over the puffs: its gradient gives one continuous bulbous surface, so terminators run
	// across the whole cloud instead of capping every puff.
	vec2 grad = vec2( 0.0 );
	float wsum = 1e-4;
	for ( int i = 0; i < 12; i++ ) {
		float fi = float( i );
		float row = i < 5 ? 0.0 : ( i < 9 ? 1.0 : 2.0 );
		float count = row == 0.0 ? 5.0 : ( row == 1.0 ? 4.0 : 3.0 );
		float idx = row == 0.0 ? fi : ( row == 1.0 ? fi - 5.0 : fi - 9.0 );
		float a = h11( vSeed * 13.1 + fi * 7.3 );
		float b = h11( vSeed * 5.7 + fi * 3.1 );
		float spread = 1.0 - row * 0.3;
		float u = ( idx + 0.5 ) / count - 0.5;
		float cx = 0.5 + u * spread * 0.84 + ( a - 0.5 ) * 0.08;
		float cy = 0.27 + row * 0.2 + ( b - 0.5 ) * 0.06 - abs( u ) * 0.08;
		float r = ( 0.21 - row * 0.03 ) * ( 0.78 + a * 0.4 ) * ( 1.0 - abs( u ) * 0.45 );
		if ( row == 2.0 && b < 0.3 ) r *= 0.6;
		vec2 dp = ( p - vec2( cx, cy ) ) * vec2( vAspect, 1.0 );
		float d2 = dot( dp, dp );
		shape = max( shape, r - sqrt( d2 ) );
		float h = sqrt( max( r * r - d2, 0.0 ) );
		float w = exp( 8.0 * h ) * step( 1e-4, h );
		grad += w * dp / max( h, 0.035 );
		wsum += w;
	}
	vec3 nPuff = normalize( vec3( grad / wsum, 1.0 ) );
	// The cloud's overall mass (a squat ellipsoid) carries the big light/shadow split; puffs add the lobes.
	vec2 m = ( p - vec2( 0.5, 0.26 ) ) / vec2( 0.5, 0.62 );
	vec3 nMass = normalize( vec3( m, sqrt( max( 1.0 - dot( m, m ), 0.08 ) ) ) );
	vec3 n = normalize( nPuff * 0.6 + nMass * 0.8 );
	// Flat base.
	shape = min( shape, ( p.y - 0.13 ) * 0.8 );
	float aa = fwidth( shape ) * 1.1 + 1e-4;
	float alpha = smoothstep( -aa, aa, shape );
	if ( alpha < 0.01 ) discard;

	vec3 sun = normalize( vSunCard );
	float ndl = dot( n, sun );
	float litAA = fwidth( ndl ) + 1e-3;
	float lit = smoothstep( -0.05 - litAA, -0.05 + litAA, ndl );
	// Second, deeper shade band in the cores facing away from the sun.
	float deep = 1.0 - smoothstep( -0.45 - litAA, -0.45 + litAA, ndl );
	vec3 col = mix( uShade, uLit, lit );
	col = mix( col, uShade * 0.84, deep * 0.6 );
	// Heavier, cooler underside.
	float base = 1.0 - smoothstep( 0.14, 0.3, p.y );
	col = mix( col, uShade * 0.9, base * 0.5 );
	// Silver lining on sun-facing edges.
	float edge = 1.0 - smoothstep( 0.0, 0.014, shape );
	float facing = smoothstep( 0.1, 0.5, dot( normalize( nPuff.xy + 1e-4 ), normalize( sun.xy + 1e-4 ) ) );
	col += uRimColor * edge * facing * 0.55;
	col += vec3( 0.8, 0.88, 1.0 ) * uFlash * ( 0.4 + lit * 0.6 );
	// Aerial perspective: far and low cards melt into the haze.
	float fade = clamp( ( vDist - 900.0 ) / 3200.0, 0.0, 1.0 ) * 0.42 + ( 1.0 - smoothstep( 0.0, 0.1, vElevation ) ) * 0.18;
	col = mix( col, uHaze, clamp( fade + uFade, 0.0, 0.96 ) );
	gl_FragColor = vec4( col, alpha * uOpacity );
}
`;

interface CardSpec { azimuth: number; distance: number; height: number; width: number; tall: number; seed: number; speed: number }

export class CloudLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  readonly uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uLit: { value: new THREE.Color(1, 1, 1) },
    uShade: { value: new THREE.Color(0.6, 0.65, 0.9) },
    uHaze: { value: new THREE.Color(0.7, 0.85, 0.95) },
    uRimColor: { value: new THREE.Color(1, 1, 1) },
    uFade: { value: 0 },
    uFlash: { value: 0 },
    uOpacity: { value: 1 },
    uCruiseNoise: atmosphereUniforms.uCruiseNoise,
  };
  private readonly cards: CardSpec[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private visibleCount: number;
  private readonly seeds: Float32Array;
  private readonly order: { index: number; distance: number }[] = [];

  constructor(maxCards = 40) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const seeds = new Float32Array(maxCards);
    let s = 1234567;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const layers = [
      { count: Math.round(maxCards * 0.38), dist: [2500, 3300], height: [150, 330], width: [900, 1600], speed: 0.0016 },
      { count: Math.round(maxCards * 0.34), dist: [1600, 2300], height: [230, 420], width: [560, 1000], speed: 0.0024 },
      { count: maxCards - Math.round(maxCards * 0.38) - Math.round(maxCards * 0.34), dist: [950, 1400], height: [300, 520], width: [320, 620], speed: 0.0034 },
    ];
    const perLayer: CardSpec[][] = [];
    for (const layer of layers) {
      const list: CardSpec[] = [];
      for (let i = 0; i < layer.count; i++) {
        const azimuth = (i / layer.count) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
        const width = THREE.MathUtils.lerp(layer.width[0]!, layer.width[1]!, rnd());
        list.push({
          azimuth,
          distance: THREE.MathUtils.lerp(layer.dist[0]!, layer.dist[1]!, rnd()),
          height: THREE.MathUtils.lerp(layer.height[0]!, layer.height[1]!, rnd()),
          width, tall: width * THREE.MathUtils.lerp(0.42, 0.62, rnd()),
          seed: rnd() * 100, speed: layer.speed * (0.7 + rnd() * 0.6),
        });
      }
      perLayer.push(list);
    }
    // Round-robin across layers so thinning (quality, weather) keeps every depth represented.
    for (let i = 0; this.cards.length < maxCards; i++) {
      for (const list of perLayer) if (i < list.length) this.cards.push(list[i]!);
      if (i > maxCards) break;
    }
    this.seeds = seeds;
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      name: 'sky-clouds', vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false, toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, maxCards);
    this.mesh.name = 'sky-clouds';
    this.mesh.frustumCulled = false;
    // Behind the ink overlay (-1e6) so ink lines drawn over the sky are never covered by cloud cards.
    this.mesh.renderOrder = -2e6;
    this.mesh.userData.inkSkip = true;
    this.mesh.userData.lookInternal = true;
    this.visibleCount = maxCards;
  }

  /** Fraction of the cards to draw (quality / weather). */
  setDensity(fraction: number): void {
    this.visibleCount = Math.max(0, Math.min(this.cards.length, Math.round(this.cards.length * fraction)));
  }

  update(time: number, centerX: number, centerZ: number, windDir: number, camera: THREE.Vector3): void {
    const drift = Math.sign(Math.sin(windDir)) || 1;
    const count = Math.min(this.cards.length, this.visibleCount);
    this.order.length = 0;
    for (let i = 0; i < count; i++) {
      const card = this.cards[i]!;
      const az = card.azimuth + time * card.speed * drift;
      const x = centerX + Math.cos(az) * card.distance, z = centerZ + Math.sin(az) * card.distance;
      this.order.push({ index: i, distance: (x - camera.x) ** 2 + (z - camera.z) ** 2 + (card.height - camera.y) ** 2 });
    }
    // Back to front: the instanced draw has no sorting of its own.
    this.order.sort((a, b) => b.distance - a.distance);
    const seedAttr = this.mesh.geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute;
    for (let n = 0; n < this.order.length; n++) {
      const card = this.cards[this.order[n]!.index]!;
      const az = card.azimuth + time * card.speed * drift;
      this.position.set(centerX + Math.cos(az) * card.distance, card.height, centerZ + Math.sin(az) * card.distance);
      this.scale.set(card.width, card.tall, 1);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.mesh.setMatrixAt(n, this.matrix);
      this.seeds[n] = card.seed;
    }
    this.mesh.count = this.order.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    seedAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
