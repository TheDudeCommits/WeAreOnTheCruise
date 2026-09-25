/**
 * CelMaterial (LOOK-owned): the one shading model for every mesh in the game.
 *
 * A MeshToonMaterial subclass, so maps, vertex colours, skinning, morphs, instancing, batching, shadows, fog, alpha
 * test and clipping all come from three's own chunks. Only the light accumulation is replaced:
 *
 *   lit ─┐ hard band 1 (terminator, fwidth anti-aliased, multiplied by the hardened shadow map + cloud shadow)
 *        ├ soft core band (a soft darkening just past the terminator, gives round forms their volume)
 *   shadow (albedo × cool blue-violet tint × sky/sea ambient)
 *        └ hard band 2 (deep back-side band)
 *   + lit-side rim (hard-edged), hard brass/wet highlight shapes (optional), cel-stepped lantern point/spot lights,
 *   + emissive (HDR, blooms), AO maps become crevice ink, hit-flash / elite glow / spectral tint (ShipTint).
 *   + faction light (instanced variants, faction.ts): at night / in storms and fog an enemy instance whose origin is
 *     in the faction map gets a hard faction-coloured rim and a +0.3 EV albedo lift, so a dark horde stays countable.
 *
 * All frame lighting comes from the shared atmosphere uniforms (./atmosphere.ts), so the ocean, islands, ships and FX
 * agree on one sun without reading three's light list.
 */
import * as THREE from 'three';
import { ATMOSPHERE_GLSL, atmosphereUniforms, ensureAtmosphereResources, installUnifiedFog } from './atmosphere';
import { FACTION_VERTEX_GLSL } from './faction';

export interface CelParameters extends THREE.MeshToonMaterialParameters {
  /** 0..1 lit-side rim strength. */
  rim?: number;
  /** 0..1 hard highlight shape strength (brass, wet surfaces). */
  specular?: number;
  /** Receives ShipTint (per-material uniforms, or per-instance through instanceColor on InstancedMesh). */
  tintable?: boolean;
  /** 0..1 taming of lighting baked into albedo maps (lifts baked darks, eases baked highlights). */
  delight?: number;
  /** Albedo saturation multiplier (1 = unchanged). */
  saturation?: number;
  /** Albedo gain (1 = unchanged). */
  gain?: number;
  /** Albedo contrast as a luminance power (1 = unchanged, >1 = deeper darks, whites kept). */
  contrast?: number;
  /** Facet normals from derivatives (three's FLAT_SHADED path works for the toon template). */
  flatShading?: boolean;
}

const VERTEX_PARS = /* glsl */ `
varying vec3 vCelWorldPos;
#if defined( CEL_TINTABLE ) && defined( USE_INSTANCING_COLOR )
varying vec3 vCelInstanceTint;
#endif
// Faction light (instanced variants look it up; USE_INSTANCING is a vertex-only define, so the varying is always on).
varying vec4 vCelFaction;
#if defined( USE_INSTANCING ) || defined( USE_BATCHING )
${FACTION_VERTEX_GLSL}
#endif
`;

const VERTEX_COLOR = /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	#ifdef CEL_TINTABLE
		// Tintable instanced meshes carry ShipTint in instanceColor: r = hit flash, g = glow, b = spectral.
		vCelInstanceTint = instanceColor.rgb;
	#else
		vColor.rgb *= instanceColor.rgb;
	#endif
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif
`;

const VERTEX_WORLD = /* glsl */ `
	{
		vec4 celWorld = vec4( transformed, 1.0 );
		#ifdef USE_BATCHING
			celWorld = batchingMatrix * celWorld;
		#endif
		#ifdef USE_INSTANCING
			celWorld = instanceMatrix * celWorld;
		#endif
		vCelWorldPos = ( modelMatrix * celWorld ).xyz;
	}
	vCelFaction = vec4( 0.0 );
	#if defined( USE_INSTANCING )
		// Faction light: look this instance's origin up in the faction map (skipped in daylight).
		if ( uCruiseFactionRim.x > 0.001 ) vCelFaction = cruiseFactionAt( ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xz );
	#elif defined( USE_BATCHING )
		if ( uCruiseFactionRim.x > 0.001 ) vCelFaction = cruiseFactionAt( ( modelMatrix * batchingMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xz );
	#endif
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vViewPosition;
varying vec3 vCelWorldPos;
#if defined( CEL_TINTABLE ) && defined( USE_INSTANCING_COLOR )
varying vec3 vCelInstanceTint;
#endif
${ATMOSPHERE_GLSL}
/** x: terminator threshold, y: deep-band threshold, z: soft core width, w: soft core strength. */
uniform vec4 uCelBands;
/** x: deep-band strength, y: rim strength, z: rim threshold (on 1 - N·V), w: hard highlight strength. */
uniform vec4 uCelShape;
/** x: delight, y: saturation, z: gain, w: contrast (luminance power). */
uniform vec4 uCelLevels;
/** x: hit flash, y: glow strength, z: spectral. */
uniform vec3 uCelTint;
uniform vec3 uCelGlowColor;
uniform vec3 uCelSpectralColor;
const vec3 CEL_LUMA = vec3( 0.2126, 0.7152, 0.0722 );
varying vec4 vCelFaction;
uniform vec4 uCruiseFactionRim;
`;

const FRAGMENT_LIGHTING = /* glsl */ `
	// ───── Cruise cel lighting (replaces three's toon light loop) ─────
	vec3 celAlbedo = diffuseColor.rgb;
	#ifdef CEL_LEVELS
	{
		// Downloaded albedo maps carry baked light: lift their darks, ease their highlights, keep the hue.
		float celL0 = max( dot( celAlbedo, CEL_LUMA ), 1e-4 );
		float celL1 = pow( celL0, 1.0 / ( 1.0 + uCelLevels.x * 0.9 ) );
		celL1 = mix( celL1, 0.16 + celL1 * 0.74, uCelLevels.x * 0.55 );
		celAlbedo *= celL1 / celL0;
		float celL2 = dot( celAlbedo, CEL_LUMA );
		celAlbedo = max( mix( vec3( celL2 ), celAlbedo, uCelLevels.y ), 0.0 ) * uCelLevels.z;
		// Contrast: luminance to a power (hue kept); pivots near white so painted whites stay white.
		float celL4 = max( dot( celAlbedo, CEL_LUMA ), 1e-4 );
		celAlbedo *= pow( min( celL4 / 0.85, 4.0 ), uCelLevels.w - 1.0 );
	}
	#endif
	// Matched enemy instances (materials with a rim; glow parts have none) get the night exposure lift.
	float celFactionK = vCelFaction.a * step( 0.01, uCelShape.y );
	celAlbedo *= mix( 1.0, uCruiseFactionRim.y, celFactionK );

	vec3 celN = normalize( normal );
	vec3 celV = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );
	vec3 celL = normalize( ( viewMatrix * vec4( uCruiseSunDir, 0.0 ) ).xyz );
	vec3 celNw = normalize( ( vec4( celN, 0.0 ) * viewMatrix ).xyz );
	float celNdotL = dot( celN, celL );

	float celShadowMap = 1.0;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	if ( receiveShadow ) {
		DirectionalLightShadow celDls = directionalLightShadows[ 0 ];
		float celRaw = getShadow( directionalShadowMap[ 0 ], celDls.shadowMapSize, 1.0, celDls.shadowBias, celDls.shadowRadius, vDirectionalShadowCoord[ 0 ] );
		celShadowMap = smoothstep( 0.35, 0.65, celRaw );
	}
	#endif
	float celCloud = cruiseCloudShadow( vCelWorldPos );

	float celAA = clamp( fwidth( celNdotL ) * 0.75, 1e-4, 0.2 );
	float celLitBand = smoothstep( uCelBands.x - celAA, uCelBands.x + celAA, celNdotL );
	float celLit = celLitBand * celShadowMap * ( 1.0 - celCloud );
	float celDeep = 1.0 - smoothstep( uCelBands.y - celAA, uCelBands.y + celAA, celNdotL );
	float celCore = smoothstep( uCelBands.x - uCelBands.z, uCelBands.x, celNdotL ) * ( 1.0 - celLitBand );

	vec3 celAmbient = mix( uCruiseGroundAmbient, uCruiseSkyAmbient, smoothstep( -0.65, 0.65, celNw.y ) );
	vec3 celShadowCol = celAlbedo * uCruiseShadowTint * celAmbient * ( 1.0 - celCore * uCelBands.w ) * ( 1.0 - celDeep * uCelShape.x );
	vec3 celLitCol = celAlbedo * uCruiseSunColor;
	vec3 celColor = mix( celShadowCol, max( celLitCol, celShadowCol ), celLit );

	// Hard-edged highlight shapes (brass, wet wood) instead of PBR specular.
	float celFres = 1.0 - max( dot( celN, celV ), 0.0 );
	if ( uCelShape.w > 0.001 ) {
		vec3 celH = normalize( celL + celV );
		float celNH = max( dot( celN, celH ), 0.0 );
		float celSpecAA = fwidth( celNH ) + 1e-4;
		celColor += uCruiseSunColor * smoothstep( 0.955 - celSpecAA, 0.955 + celSpecAA, celNH ) * celLit * uCelShape.w;
	}

	// Lit-side rim.
	{
		float celRimAA = fwidth( celFres ) + 1e-4;
		float celRim = smoothstep( uCelShape.z - celRimAA, uCelShape.z + celRimAA, celFres );
		celRim *= smoothstep( -0.2, 0.3, celNdotL ) * mix( 0.3, 1.0, celShadowMap );
		celColor += uCruiseRimColor * ( 0.35 + 0.65 * celAlbedo ) * celRim * uCelShape.y;
		// Faction rim: all around the silhouette (not only the lit side), hard-edged, HDR.
		float celFRim = smoothstep( uCruiseFactionRim.z - celRimAA, uCruiseFactionRim.z + celRimAA, celFres );
		celColor += vCelFaction.rgb * celFRim * uCruiseFactionRim.x * celFactionK;
	}

	// Lanterns and searchlights: cel-stepped pools of light.
	#if NUM_POINT_LIGHTS > 0
	IncidentLight celPl;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		getPointLightInfo( pointLights[ i ], - vViewPosition, celPl );
		float celPi = dot( celPl.color, vec3( 0.3333 ) );
		float celPq = smoothstep( 0.03, 0.07, celPi ) * 0.45 + smoothstep( 0.32, 0.42, celPi ) * 0.55;
		celColor += celAlbedo * ( celPl.color / max( celPi, 1e-4 ) ) * celPq * smoothstep( -0.1, 0.05, dot( celN, celPl.direction ) ) * min( celPi * 2.0, 1.4 );
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHTS > 0
	IncidentLight celSl;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		getSpotLightInfo( spotLights[ i ], - vViewPosition, celSl );
		float celSi = dot( celSl.color, vec3( 0.3333 ) );
		float celSq = smoothstep( 0.03, 0.08, celSi );
		celColor += celAlbedo * ( celSl.color / max( celSi, 1e-4 ) ) * celSq * smoothstep( -0.1, 0.05, dot( celN, celSl.direction ) ) * min( celSi * 2.0, 1.6 );
	}
	#pragma unroll_loop_end
	#endif

	// Ambient occlusion maps become crevice ink rather than a grey multiply.
	#ifdef USE_AOMAP
	{
		float celAo = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
		celColor = mix( mix( celColor, uCruiseInkColor, 0.72 ), celColor, smoothstep( 0.25, 0.85, celAo ) );
	}
	#endif

	// ShipTint: spectral, glow, hit flash.
	{
		vec3 celTint = uCelTint;
		#if defined( CEL_TINTABLE ) && defined( USE_INSTANCING_COLOR )
			celTint = max( celTint, vCelInstanceTint );
		#endif
		if ( celTint.z > 0.001 ) {
			float celG = dot( celColor, CEL_LUMA );
			celColor = mix( celColor, uCelSpectralColor * ( celG * 1.5 + 0.06 ), celTint.z * 0.85 );
			celColor += uCelSpectralColor * pow( celFres, 2.0 ) * 2.4 * celTint.z;
		}
		// Elite glow: a hot rim (blooms) over a faint body tint, never a wash.
		celColor += uCelGlowColor * celTint.y * ( 0.045 + pow( celFres, 3.0 ) * 2.4 );
		celColor = mix( celColor, vec3( 1.9, 1.78, 1.6 ), clamp( celTint.x, 0.0, 1.0 ) * 0.8 );
	}

	vec3 celOutgoing = celColor + totalEmissiveRadiance;
`;

const CACHE_KEY = 'cruise-cel-v2';

let celCount = 0;

export class CelMaterial extends THREE.MeshToonMaterial {
  readonly isCelMaterial = true;
  /** Read by three's program parameters (FLAT_SHADED); MeshToonMaterial does not declare it. */
  flatShading = false;
  /** Per-material uniforms (the atmosphere uniforms are shared). */
  readonly cel = {
    uCelBands: { value: new THREE.Vector4(0.0, -0.55, 0.34, 0.16) },
    uCelShape: { value: new THREE.Vector4(0.12, 0.35, 0.62, 0) },
    uCelLevels: { value: new THREE.Vector4(0, 1, 1, 1) },
    uCelTint: { value: new THREE.Vector3(0, 0, 0) },
    uCelGlowColor: { value: new THREE.Color(0xffb640) },
    uCelSpectralColor: { value: new THREE.Color(0x3ff0d0) },
  };

  constructor(parameters: CelParameters = {}) {
    super();
    ensureAtmosphereResources();
    installUnifiedFog();
    // `type` stays 'MeshToonMaterial': three picks the shader template by type.
    this.name = 'cel';
    this.defines = {};
    const { rim, specular, tintable, delight, saturation, gain, contrast, ...toon } = parameters;
    this.setValues(toon);
    if (rim !== undefined) this.rim = rim;
    if (specular !== undefined) this.specular = specular;
    if (tintable) this.tintable = true;
    if (delight !== undefined || saturation !== undefined || gain !== undefined || contrast !== undefined) {
      this.setLevels(delight ?? 0, saturation ?? 1, gain ?? 1, contrast ?? 1);
    }
    celCount++;
  }

  get rim(): number { return this.cel.uCelShape.value.y; }
  set rim(value: number) { this.cel.uCelShape.value.y = value; }
  get specular(): number { return this.cel.uCelShape.value.w; }
  set specular(value: number) { this.cel.uCelShape.value.w = value; }

  get tintable(): boolean { return this.defines?.CEL_TINTABLE !== undefined; }
  set tintable(value: boolean) {
    if (value === this.tintable) return;
    if (value) this.defines!.CEL_TINTABLE = '';
    else delete this.defines!.CEL_TINTABLE;
    this.needsUpdate = true;
  }

  /** Albedo levels: delight 0..1 (tames baked lighting), saturation and gain multipliers, contrast (1 = off). */
  setLevels(delight: number, saturation = 1, gain = 1, contrast = 1): this {
    this.cel.uCelLevels.value.set(delight, saturation, gain, contrast);
    const active = delight > 0.001 || Math.abs(saturation - 1) > 0.001 || Math.abs(gain - 1) > 0.001 || Math.abs(contrast - 1) > 0.001;
    const had = this.defines!.CEL_LEVELS !== undefined;
    if (active && !had) { this.defines!.CEL_LEVELS = ''; this.needsUpdate = true; }
    if (!active && had) { delete this.defines!.CEL_LEVELS; this.needsUpdate = true; }
    return this;
  }

  /** Per-material ShipTint (non-instanced meshes). */
  setTint(flash: number, glow = 0, spectral = 0, glowColor?: THREE.ColorRepresentation): this {
    this.cel.uCelTint.value.set(flash, glow, spectral);
    if (glowColor !== undefined) this.cel.uCelGlowColor.value.set(glowColor);
    return this;
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, atmosphereUniforms, this.cel);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <color_vertex>', VERTEX_COLOR)
      .replace('#include <fog_vertex>', `#include <fog_vertex>\n${VERTEX_WORLD}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_toon_pars_fragment>', FRAGMENT_PARS)
      .replace('#include <lights_toon_fragment>', FRAGMENT_LIGHTING)
      .replace('#include <lights_fragment_begin>', '')
      .replace('#include <lights_fragment_maps>', '')
      .replace('#include <lights_fragment_end>', '')
      .replace('#include <aomap_fragment>', '')
      .replace(
        'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
        'vec3 outgoingLight = celOutgoing;',
      );
  }

  override customProgramCacheKey(): string { return CACHE_KEY; }

  override copy(source: CelMaterial): this {
    super.copy(source);
    this.defines = { ...(source.defines ?? {}) };
    this.flatShading = source.flatShading === true;
    if (source.cel) {
      this.cel.uCelBands.value.copy(source.cel.uCelBands.value);
      this.cel.uCelShape.value.copy(source.cel.uCelShape.value);
      this.cel.uCelLevels.value.copy(source.cel.uCelLevels.value);
      this.cel.uCelTint.value.copy(source.cel.uCelTint.value);
      this.cel.uCelGlowColor.value.copy(source.cel.uCelGlowColor.value);
      this.cel.uCelSpectralColor.value.copy(source.cel.uCelSpectralColor.value);
    }
    return this;
  }
}

export function isCelMaterial(material: unknown): material is CelMaterial {
  return (material as CelMaterial | null)?.isCelMaterial === true;
}

/** Number of CelMaterials created (diagnostics). */
export function celMaterialCount(): number { return celCount; }
