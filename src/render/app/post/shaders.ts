/**
 * Full-screen shaders for the post stack (LOOK-owned). All passes draw one oversized triangle.
 * Bloom: dual-filter (Kawase) down/up chain on the half-float HDR buffer with a soft-knee threshold and a Karis
 * average in the prefilter (no fireflies from single-pixel glints).
 * Composite: bloom add → exposure → Khronos PBR Neutral tone map (keeps flat cel colours honest, compresses only
 * highlights) → sRGB → grade (lift/gamma/gain, saturation, contrast, split tone) → vignette → flash, speed lines,
 * rain streaks, impact frame → dither.
 */

export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

export const PREFILTER_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;
uniform vec3 uThreshold; // x threshold, y knee, z clamp
varying vec2 vUv;
vec3 prefilter( vec3 c ) {
	float br = max( c.r, max( c.g, c.b ) );
	float rq = clamp( br - uThreshold.x + uThreshold.y, 0.0, 2.0 * uThreshold.y );
	rq = ( rq * rq ) / ( 4.0 * uThreshold.y + 1e-5 );
	float contrib = max( rq, br - uThreshold.x ) / max( br, 1e-5 );
	return min( c * contrib, vec3( uThreshold.z ) );
}
float karis( vec3 c ) { return 1.0 / ( 1.0 + max( c.r, max( c.g, c.b ) ) ); }
void main() {
	vec2 o = uTexel;
	vec3 a = texture2D( tSource, vUv + vec2( -o.x, -o.y ) ).rgb;
	vec3 b = texture2D( tSource, vUv + vec2(  o.x, -o.y ) ).rgb;
	vec3 c = texture2D( tSource, vUv + vec2( -o.x,  o.y ) ).rgb;
	vec3 d = texture2D( tSource, vUv + vec2(  o.x,  o.y ) ).rgb;
	a = prefilter( a ); b = prefilter( b ); c = prefilter( c ); d = prefilter( d );
	float wa = karis( a ), wb = karis( b ), wc = karis( c ), wd = karis( d );
	vec3 sum = ( a * wa + b * wb + c * wc + d * wd ) / max( wa + wb + wc + wd, 1e-5 );
	gl_FragColor = vec4( sum, 1.0 );
}
`;

export const DOWNSAMPLE_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel; // half texel of the source
varying vec2 vUv;
void main() {
	vec3 sum = texture2D( tSource, vUv ).rgb * 4.0;
	sum += texture2D( tSource, vUv - uTexel ).rgb;
	sum += texture2D( tSource, vUv + uTexel ).rgb;
	sum += texture2D( tSource, vUv + vec2( uTexel.x, -uTexel.y ) ).rgb;
	sum += texture2D( tSource, vUv - vec2( uTexel.x, -uTexel.y ) ).rgb;
	gl_FragColor = vec4( sum * 0.125, 1.0 );
}
`;

export const UPSAMPLE_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;   // lower-resolution accumulated level
uniform sampler2D tDetail;   // this level's downsample
uniform vec2 uTexel;         // half texel of tSource
uniform float uScatter;
varying vec2 vUv;
void main() {
	vec2 h = uTexel;
	vec3 sum = texture2D( tSource, vUv + vec2( -h.x * 2.0, 0.0 ) ).rgb;
	sum += texture2D( tSource, vUv + vec2( -h.x, h.y ) ).rgb * 2.0;
	sum += texture2D( tSource, vUv + vec2( 0.0, h.y * 2.0 ) ).rgb;
	sum += texture2D( tSource, vUv + vec2( h.x, h.y ) ).rgb * 2.0;
	sum += texture2D( tSource, vUv + vec2( h.x * 2.0, 0.0 ) ).rgb;
	sum += texture2D( tSource, vUv + vec2( h.x, -h.y ) ).rgb * 2.0;
	sum += texture2D( tSource, vUv + vec2( 0.0, -h.y * 2.0 ) ).rgb;
	sum += texture2D( tSource, vUv + vec2( -h.x, -h.y ) ).rgb * 2.0;
	gl_FragColor = vec4( texture2D( tDetail, vUv ).rgb + sum / 12.0 * uScatter, 1.0 );
}
`;

export const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBloomStrength;
uniform float uExposure;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uSplit;
uniform vec4 uVignette;       // rgb colour, a strength
uniform vec4 uFlash;          // rgb colour, a strength (screen blend)
uniform float uChromatic;
uniform vec4 uSpeed;          // x strength, y seed, zw centre (uv)
uniform vec4 uImpact;         // x strength, y invert, z threshold, w seed
uniform vec3 uImpactInk;
uniform vec3 uImpactPaper;
uniform vec4 uRain;           // x strength, y angle (rad), z speed, w seed
uniform float uDither;
varying vec2 vUv;

const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );

float hash12( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}

// Khronos PBR Neutral: identity through the cel range, smooth highlight roll-off, hue preserved.
vec3 neutralTonemap( vec3 color ) {
	const float startCompression = 0.8 - 0.04;
	const float desaturation = 0.15;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < startCompression ) return color;
	const float d = 1.0 - startCompression;
	float newPeak = 1.0 - d * d / ( peak + d - startCompression );
	color *= newPeak / peak;
	float g = 1.0 - 1.0 / ( desaturation * ( peak - newPeak ) + 1.0 );
	return mix( color, vec3( newPeak ), g );
}

vec3 toSRGB( vec3 c ) {
	c = max( c, 0.0 );
	return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - 0.055, c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
}

void main() {
	vec2 uv = vUv;
	vec3 hdr;
	if ( uChromatic > 0.0005 ) {
		vec2 dir = ( uv - 0.5 ) * uChromatic;
		hdr.r = texture2D( tColor, uv + dir ).r;
		hdr.g = texture2D( tColor, uv ).g;
		hdr.b = texture2D( tColor, uv - dir ).b;
	} else {
		hdr = texture2D( tColor, uv ).rgb;
	}
	hdr += texture2D( tBloom, uv ).rgb * uBloomStrength;
	vec3 c = toSRGB( neutralTonemap( hdr * uExposure ) );

	// Grade (display space).
	c = pow( max( c, 0.0 ), 1.0 / uGamma );
	c = c * uGain + uLift * ( 1.0 - c );
	float l = dot( c, LUMA );
	c = mix( vec3( l ), c, uSaturation );
	c = ( c - 0.5 ) * uContrast + 0.5;
	vec3 tone = mix( uShadowTint, uHighlightTint, smoothstep( 0.08, 0.7, l ) );
	tone /= max( dot( tone, LUMA ), 1e-3 );
	c *= mix( vec3( 1.0 ), tone, uSplit );
	c = clamp( c, 0.0, 1.0 );

	// Vignette.
	vec2 centred = uv - 0.5;
	centred.x *= uResolution.x / uResolution.y;
	float v = smoothstep( 0.35, 1.05, length( centred ) * 1.25 );
	c = mix( c, c * uVignette.rgb, v * uVignette.a );

	// Screen-space rain streaks (storm).
	if ( uRain.x > 0.001 ) {
		vec2 q = vec2( uv.x * uResolution.x / uResolution.y, uv.y );
		float ca = cos( uRain.y ), sa = sin( uRain.y );
		q = vec2( ca * q.x - sa * q.y, sa * q.x + ca * q.y );
		float lanes = 150.0;
		float lane = floor( q.x * lanes );
		float h = hash12( vec2( lane, 7.0 ) );
		float fall = q.y * ( 1.5 + h * 1.5 ) + uTime * uRain.z * ( 0.8 + h * 0.6 ) + h * 13.0;
		float seg = fract( fall );
		float live = step( 1.0 - uRain.x * 0.55, hash12( vec2( lane, floor( fall ) ) ) );
		float across = abs( fract( q.x * lanes ) - 0.5 );
		float streak = live * smoothstep( 0.0, 0.08, seg ) * ( 1.0 - smoothstep( 0.14, 0.3, seg ) ) * ( 1.0 - smoothstep( 0.06, 0.2, across ) );
		c = mix( c, vec3( 0.86, 0.93, 0.98 ), streak * 0.32 * uRain.x );
	}

	// Flash (screen blend).
	c = 1.0 - ( 1.0 - c ) * ( 1.0 - uFlash.rgb * uFlash.a );

	// Anime speed lines: radial streaks re-rolled every other frame, tapering toward the centre.
	if ( uSpeed.x > 0.001 ) {
		vec2 p = ( uv - uSpeed.zw ) * vec2( uResolution.x / uResolution.y, 1.0 );
		float r = length( p );
		float a = atan( p.y, p.x ) / 6.2831853 + 0.5;
		float bins = 220.0;
		float bin = floor( a * bins );
		float h = hash12( vec2( bin, uSpeed.y ) );
		float h2 = hash12( vec2( bin * 1.7, uSpeed.y + 3.1 ) );
		float on = step( 1.0 - 0.42 * uSpeed.x, h );
		float inner = mix( 0.62, 0.3, uSpeed.x ) + h2 * 0.22;
		float radial = smoothstep( inner, inner + 0.2, r );
		float w = abs( fract( a * bins ) - 0.5 ) * 2.0;
		float thinness = 1.0 - smoothstep( 0.15 + 0.5 * radial * h2, 0.35 + 0.5 * radial * h2, w );
		float line = on * radial * thinness;
		c = mix( c, vec3( 1.0, 0.99, 0.96 ), line * min( 1.0, uSpeed.x * 1.2 ) * 0.82 );
	}

	// Impact frame: the whole frame collapses to two inks for a frame or two.
	if ( uImpact.x > 0.001 ) {
		float il = dot( c, LUMA );
		float t = smoothstep( uImpact.z - 0.03, uImpact.z + 0.03, il );
		if ( uImpact.y > 0.5 ) t = 1.0 - t;
		vec3 imp = mix( uImpactInk, uImpactPaper, t );
		vec2 p = ( uv - 0.5 ) * vec2( uResolution.x / uResolution.y, 1.0 );
		float a = atan( p.y, p.x ) / 6.2831853 + 0.5;
		float burst = step( 0.72, hash12( vec2( floor( a * 90.0 ), uImpact.w ) ) ) * smoothstep( 0.18, 0.55, length( p ) );
		imp = mix( imp, uImpact.y > 0.5 ? uImpactInk : uImpactPaper, burst * 0.9 );
		c = mix( c, imp, uImpact.x );
	}

	// Dither away banding in the sky and sea gradients.
	c += ( hash12( gl_FragCoord.xy + fract( uTime ) * 61.0 ) - 0.5 ) * uDither;
	gl_FragColor = vec4( c, 1.0 );
}
`;
