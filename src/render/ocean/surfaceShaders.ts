/**
 * Ocean surface GLSL (OCEAN-owned).
 *
 * Vertex: a screen-space grid (NDC with overscan) is projected onto the y = 0 plane from the camera, so the mesh
 * is always centred on the camera with uniform on-screen density (dense near, coarse far, continuous LOD, no
 * snapping or popping). Each Gerstner wave is faded by the local grid footprint (the same filter heightAt uses),
 * then the interaction target's raise - lower is added as visual-only displacement.
 *
 * Fragment: shading is evaluated per pixel at the interpolated *base* (Lagrangian) position, so normals, crests
 * and whitecaps are exact and do not swim with the grid. Detail normals are two mipmapped wind-aligned
 * textures that fade with distance; glints use a Toksvig-widened lobe with fwidth anti-aliasing. Foam is shaped
 * (rounded blobs + lace + blue-grey edge) from a mipmapped shape texture with footprint-aware thresholds.
 */
import { GERSTNER_FILTER_GLSL, GERSTNER_WAVE_COUNT } from '../../core/waves';

const COMMON = /* glsl */ `
#define WAVE_COUNT ${GERSTNER_WAVE_COUNT}
uniform vec2 uOrigin;
uniform vec4 uWaveA[WAVE_COUNT]; // dir.x, dir.z, k, wavelength
uniform vec4 uWaveB[WAVE_COUNT]; // amplitude, horizontal amplitude, phase at origin (mod 2pi), 0
uniform sampler2D uTransient;
uniform vec4 uRtRect;            // origin.x, origin.z, size, 1/size
uniform vec4 uShoreRect;         // centre.x, centre.z, valid half span, 1/(n*texel)
${GERSTNER_FILTER_GLSL}
`;

export const OCEAN_VERTEX = /* glsl */ `
${COMMON}
uniform mat4 uInvViewProj;
uniform float uFarDist;
uniform float uGridAngle;
uniform sampler2D uFoamTex;
uniform vec2 uCloudOff;

varying vec3 vWorld;
varying float vCloud;
varying vec2 vRel;
varying vec2 vWRel;
varying vec2 vRtUv;
varying vec2 vShoreUv;
varying float vFoot;
varying float vViewDepth;

vec3 projectToWater(vec2 ndc) {
  vec4 a = uInvViewProj * vec4(ndc, -1.0, 1.0);
  vec4 b = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 o = a.xyz / a.w;
  vec3 dir = b.xyz / b.w - o;
  float horiz = length(dir.xz);
  vec2 hd = horiz > 1e-6 ? dir.xz / horiz : vec2(0.0, 1.0);
  float dist = uFarDist;
  if (dir.y < -1e-6) dist = min(max(o.y, 0.05) * horiz / -dir.y, uFarDist);
  return vec3(o.x + hd.x * dist, 0.0, o.z + hd.y * dist);
}

void main() {
  vec3 base = projectToWater(position.xy);
  float d = distance(cameraPosition, base);
  float h = max(cameraPosition.y, 1.0);
  float foot = uGridAngle * d * d / h;
  vec2 rel = base.xz - uOrigin;
  vec3 disp = vec3(0.0);
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 A = uWaveA[i];
    vec4 B = uWaveB[i];
    float f = gerstnerFilter(A.w, foot);
    float ph = A.z * dot(A.xy, rel) + B.z;
    disp.xz += A.xy * (B.y * f * cos(ph));
    disp.y += B.x * f * sin(ph);
  }
  vec3 world = vec3(base.x + disp.x, disp.y, base.z + disp.z);
  vec2 rtUv = (world.xz - uRtRect.xy) * uRtRect.w;
  vec2 e = smoothstep(vec2(0.0), vec2(0.06), rtUv) * smoothstep(vec2(1.0), vec2(0.94), rtUv);
  vec4 tr = textureLod(uTransient, rtUv, 0.0);
  world.y += (tr.r - tr.g) * e.x * e.y * (1.0 - smoothstep(1.6, 4.5, foot));
  vWorld = world;
  vRel = rel;
  vWRel = world.xz - uOrigin;
  // Low-frequency painterly patches (230 m tiles): per-vertex is plenty; LOD from the grid footprint.
  vCloud = textureLod(uFoamTex, vWRel * (1.0 / 230.0) + uCloudOff, clamp(log2(max(foot, 0.45) / 0.45), 0.0, 9.0)).b;
  vRtUv = rtUv;
  vShoreUv = world.xz * uShoreRect.w;
  vFoot = foot;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vViewDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const OCEAN_FRAGMENT = /* glsl */ `
precision highp float;
${COMMON}
uniform sampler2D uPersist;
uniform sampler2D uCoverage;     // visible-foam coverage of the field (R = all, G = persistent), mipmapped
uniform vec4 uStats;             // QA stats view: centre.xz, radius (m), rim-brightness reference
uniform float uRtTexel;          // 1 / resolution
uniform float uRtWorldTexel;     // metres per texel
uniform sampler2D uShore;
uniform float uShoreMax;
uniform sampler2D uDetailA;
uniform sampler2D uDetailB;
uniform sampler2D uFoamTex;
uniform vec4 uDetailOff;         // offsets A.xy, B.xy (texture space)
uniform vec2 uDetailScale;       // 1/tileA, 1/tileB (metres)
uniform vec4 uFoamOff;           // Eulerian.xy, Lagrangian.xy
uniform vec4 uWind;              // dir.xy, strength, streak
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uFogColor;
uniform vec2 uFog;               // near, far
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uSSS;
uniform vec3 uShallow;
uniform vec3 uFoamColor;
uniform vec3 uFoamShadow;
uniform vec3 uBiolum;
uniform vec4 uLookA;             // glint, sheen, spec power, detail strength
uniform vec4 uLookB;             // cap lo, cap hi, reflectivity, sss strength
uniform vec4 uLookC;             // cloud patch, night, flash, sun level
uniform vec4 uLookD;             // dusk warmth, glitter path spread (σ²), glint fade distance (m), 0
uniform float uAmpSum;
uniform float uCapNorm;          // sum of q*k*A: max horizontal compression (normalises the Jacobian)
uniform float uTime;             // wrapped render clock (surf animation)
uniform float uDebug;

varying vec3 vWorld;
varying vec2 vRel;
varying vec2 vWRel;
varying vec2 vRtUv;
varying vec2 vShoreUv;
varying float vFoot;
varying float vViewDepth;
varying float vCloud;
uniform float uShoreActive;

void main() {
#if OCEAN_PROFILE == 1
  gl_FragColor = vec4(0.05, 0.25, 0.6, 1.0);
  #include <colorspace_fragment>
  return;
#endif
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-4);
  float pix = max(max(length(dFdx(vRel)), length(dFdy(vRel))), 1e-3);

  // ── Gerstner at the base point, filtered by the pixel footprint ──
  vec3 T = vec3(1.0, 0.0, 0.0);
  vec3 Bt = vec3(0.0, 0.0, 1.0);
  float height = 0.0;
  // Along-swell slope and curvature of the height field: their ratio is the distance (m) to the nearest crest
  // ridge, used to paint thin crest lines that follow the combined (wavy) crests.
  vec2 d1 = uWaveA[0].xy;
  float ridgeS = 0.0;
  float ridgeC = 0.0;
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 A = uWaveA[i];
    vec4 B = uWaveB[i];
    float f = gerstnerFilter(A.w, pix * 2.0);
    float ph = A.z * dot(A.xy, vRel) + B.z;
    float s = sin(ph);
    float c = cos(ph);
    float slope = B.y * f * A.z * s;
    float vert = B.x * f * A.z * c;
    T += vec3(-A.x * A.x * slope, A.x * vert, -A.x * A.y * slope);
    Bt += vec3(-A.x * A.y * slope, A.y * vert, -A.y * A.y * slope);
    height += B.x * f * s;
    float along = dot(d1, A.xy);
    ridgeS += along * vert;
    ridgeC -= along * along * B.x * f * A.z * A.z * s;
  }
  vec3 Ng = normalize(cross(Bt, T));
  float jac = T.x * Bt.z - Bt.x * T.z;
#if OCEAN_PROFILE == 2
  gl_FragColor = vec4(Ng * 0.5 + 0.5 + vec3(jac, height, ridgeS / max(-ridgeC, 1e-4)) * 0.01, 1.0);
  return;
#endif
  vec2 slope = -Ng.xz / max(Ng.y, 0.2);
  float hN = height / max(uAmpSum, 0.05);

  // ── Interaction targets ──
  // Fetches are skipped outside the targets and, for the gradient, far from the camera (coherent branches).
  vec2 e2 = smoothstep(vec2(0.0), vec2(0.06), vRtUv) * smoothstep(vec2(1.0), vec2(0.94), vRtUv);
  float rtEdge = e2.x * e2.y;
  vec4 tr = vec4(0.0);
  vec4 pr = vec4(0.0);
  float lift = 0.0;
  float crowd = 0.0;
  if (rtEdge > 0.0) {
    vec4 trRaw = texture(uTransient, vRtUv);
    pr = texture(uPersist, vRtUv) * rtEdge;
    tr = trRaw * rtEdge;
    // Neighbourhood foam coverage (~12-24 m): high = a pile-up, drawn as aerated turquoise + lace.
    crowd = textureLod(uCoverage, vRtUv, 1.0).r * rtEdge;
    float h0 = trRaw.r - trRaw.g;
    lift = h0 * rtEdge;
    if (pix < 4.0) {
      // Central differences over 1.5 texels: smooth gradients (forward differences of a bilinear texture
      // are piecewise constant and read as stair-steps up close).
      float o = uRtTexel * 1.5;
      vec4 a = texture(uTransient, vRtUv + vec2(o, 0.0));
      vec4 b = texture(uTransient, vRtUv - vec2(o, 0.0));
      vec4 c = texture(uTransient, vRtUv + vec2(0.0, o));
      vec4 d = texture(uTransient, vRtUv - vec2(0.0, o));
      vec2 rtSlope = vec2((a.r - a.g) - (b.r - b.g), (c.r - c.g) - (d.r - d.g)) / (3.0 * uRtWorldTexel);
      slope += rtSlope * rtEdge * (1.0 - smoothstep(1.2, 4.0, pix));
    }
  }
  vec3 Nm = normalize(vec3(-slope.x, 1.0, -slope.y));

  // ── Detail normals: wind aligned, scrolling, faded with distance ──
  vec2 wd = uWind.xy;
  vec2 wp = vec2(-wd.y, wd.x);
  vec2 pw = vec2(dot(vRel, wd), dot(vRel, wp));
  // Derivatives are taken in uniform control flow; branched fetches use textureGrad (mip selection stays valid).
  vec2 pwDx = dFdx(pw);
  vec2 pwDy = dFdy(pw);
  vec2 wrDx = dFdx(vWRel);
  vec2 wrDy = dFdy(vWRel);
  float fadeA = uLookA.w * (1.0 - smoothstep(100.0, 650.0, dist));
  float fadeB = uLookA.w * (1.0 - smoothstep(25.0, 170.0, dist)) * 0.5;
  vec2 sDet = vec2(0.0);
  float ft = 1.0;
  if (fadeA > 0.0) {
    vec3 nA = textureGrad(uDetailA, pw * uDetailScale.x + uDetailOff.xy, pwDx * uDetailScale.x, pwDy * uDetailScale.x).xyz * 2.0 - 1.0;
    sDet = nA.xz / max(nA.y, 0.35) * fadeA;
    float lenN = length(nA);
    if (fadeB > 0.0) {
      mat2 rotB = mat2(0.94, -0.34, 0.34, 0.94);
      vec2 pwB = rotB * pw;
      vec3 nB = textureGrad(uDetailB, pwB * uDetailScale.y + uDetailOff.zw, (rotB * pwDx) * uDetailScale.y, (rotB * pwDy) * uDetailScale.y).xyz * 2.0 - 1.0;
      vec2 sB = nB.xz / max(nB.y, 0.35) * fadeB;
      sDet += vec2(sB.x * 0.94 - sB.y * 0.34, sB.x * 0.34 + sB.y * 0.94);
      lenN = min(lenN, length(nB));
    }
    ft = mix(1.0, clamp(lenN, 0.05, 1.0), clamp(fadeA * 1.5, 0.0, 1.0));
  }
  vec2 detWorld = wd * sDet.x + wp * sDet.y;
  vec3 Nd = normalize(vec3(-(slope.x + detWorld.x), 1.0, -(slope.y + detWorld.y)));
  float P = uLookA.z;
  float Peff = max(P * ft / (ft + P * (1.0 - ft)), 6.0);

#if OCEAN_PROFILE == 3
  gl_FragColor = vec4(Nd * 0.5 + 0.5 + vec3(tr.b, pr.r, ft) * 0.01, 1.0);
  return;
#endif
  // ── Light & view ──
  vec3 L = normalize(uSunDir);
  float sunUp = smoothstep(-0.04, 0.1, L.y);
  float NdV = clamp(dot(Nm, V), 0.0, 1.0);

  // ── Shore field ──
  float shoreD = uShoreMax;
  float shoreValid = 0.0;
  if (uShoreActive > 0.5) {
    vec2 sdd = abs(vWorld.xz - uShoreRect.xy);
    shoreValid = 1.0 - smoothstep(uShoreRect.z - 40.0, uShoreRect.z, max(sdd.x, sdd.y));
    if (shoreValid > 0.0) shoreD = mix(uShoreMax, texture(uShore, vShoreUv).r, shoreValid);
  }
  float shallowAmt = 1.0 - smoothstep(4.0, 90.0, shoreD + (vCloud - 0.5) * 34.0);

  // ── Body colour: deep cobalt looking down, turquoise-leaning at grazing faces, soft cel bands ──
  // View-angle depth uses a flattened normal (swell faces tint, they do not stripe) plus the actual view angle.
  float NdVsoft = clamp(dot(normalize(mix(vec3(0.0, 1.0, 0.0), Nm, 0.55)), V), 0.0, 1.0);
  float deepness = smoothstep(0.12, 0.92, NdVsoft);
  vec3 body = mix(uMid, uDeep, deepness);
  // Sun-facing faces lighter; the sensitivity drops with a low sun so dusk light does not stripe the swells.
  float tone = clamp(0.54 + (dot(Nm, L) - L.y) * 1.25 * mix(0.3, 1.0, clamp(L.y * 1.4, 0.0, 1.0)) + hN * 0.4 + lift * 0.12, 0.0, 1.0);
  vec3 cShadow = mix(uDeep, uMid, 0.12) * 0.86;
  vec3 cLight = mix(uMid, uSSS, 0.22);
  vec3 col = mix(cShadow, body, smoothstep(0.08, 0.46, tone));
  col = mix(col, cLight, smoothstep(0.64, 0.94, tone) * 0.5);

  // Back-lit crest glow (sun through thin water), incl. water piled up by the bow wave.
  vec2 Lh = normalize(L.xz + vec2(1e-4, 0.0));
  vec2 Vh = normalize(-V.xz + vec2(0.0, 1e-4));
  float backLit = clamp(dot(Vh, Lh), 0.0, 1.0);
  float thin = clamp(hN * 1.25 + 0.05, 0.0, 1.0) + clamp(lift * 0.5, 0.0, 1.3);
  float faceView = clamp(dot(Nm.xz, -Vh) * 3.0 + 0.4, 0.0, 1.0);
  float sss = thin * (0.22 + 0.78 * backLit * backLit) * (0.55 + 0.45 * faceView) * (1.0 - 0.45 * L.y) * uLookB.w * sunUp;
  col += uSSS * uSunColor * sss * 0.6;

  // Aerated churn from wakes/bow waves reads lighter and turquoise.
  float aer = clamp(max(pr.g, tr.a), 0.0, 1.0);
  col = mix(col, mix(uSSS, uShallow, 0.45) * (0.45 + 0.55 * uLookC.w), aer * 0.5);

  // Teal shallows near coasts.
  col = mix(col, uShallow * mix(0.82, 1.08, smoothstep(0.3, 0.7, tone)), shallowAmt * 0.82);
  col = mix(col, uShallow * 1.22 + vec3(0.02, 0.035, 0.0), (1.0 - smoothstep(0.0, 16.0, shoreD)) * 0.45);

  // ── Sky reflection (Fresnel), painterly cloud tint, lightning flash ──
  // Reflection uses a softened normal (macro + 40% detail) so ripples tint rather than stripe the sky.
  vec3 Nr = normalize(mix(Nm, Nd, 0.4));
  vec3 Rr = reflect(-V, Nr);
  vec3 R = reflect(-V, Nd);
  // Fresnel from the softened macro normal (detail ripples at grazing angles would stripe it), capped so the
  // far sea stays saturated blue up to a readable horizon line; the fog curve does the distance blend.
  float fx = 1.0 - clamp(dot(normalize(mix(vec3(0.0, 1.0, 0.0), Nm, 0.6)), V), 0.0, 1.0);
  float fx2 = fx * fx;
  float F = min(0.02 + 0.98 * fx2 * fx2 * fx, 0.58);
  vec3 refl = mix(uHorizon, uSky, smoothstep(0.0, 0.45, Rr.y));
  refl = mix(refl, uSky, 0.3);
  // Dusk seen from the steep tactical pitch: the water reflects the zenith, the darkest and most violet part of the
  // evening sky (the round-1 magenta sheet). Tint it from the warm horizon and haze instead.
  refl = mix(refl, mix(uHorizon, uFogColor, 0.35), uLookD.x * smoothstep(0.3, 0.75, V.y) * 0.6);
  refl *= 1.0 + (vCloud - 0.5) * uLookC.x * 1.4;
  refl += vec3(0.85, 0.9, 1.0) * uLookC.z * 0.9;
  col = mix(col, refl, clamp(F * uLookB.z * (1.0 - shallowAmt * 0.35), 0.0, 1.0));

#if OCEAN_PROFILE == 4
  gl_FragColor = vec4(col, 1.0);
  return;
#endif
  // ── Foam: interaction + shore (Eulerian) and whitecaps (Lagrangian, wind-stretched strokes) ──
  float farBlur = smoothstep(0.35, 2.6, pix);
  float covI = clamp(max(pr.r, tr.b), 0.0, 1.5);
  // Shape textures are only fetched where foam can exist (most of the open sea skips them).
  vec4 fE = vec4(0.5);
  if (covI > 0.0 || shoreD < 36.0) fE = textureGrad(uFoamTex, vWRel * (1.0 / 26.0) + uFoamOff.xy, wrDx * (1.0 / 26.0), wrDy * (1.0 / 26.0));
  // Whitecaps: a band on the sharpest crests (Jacobian compression normalised by the sea state's maximum),
  // broken into wind-aligned strokes; never thresholded noise (no speckle at low coverage).
  float compress = clamp((1.0 - jac) / max(uCapNorm, 1e-3), 0.0, 1.5);
  float ridgeDist = abs(ridgeS) / max(-ridgeC, 1e-5);
  float ridgeW = 0.32 + 0.45 * uWind.z + 1.4 * uWind.w;
  float ridge = (1.0 - smoothstep(ridgeW * 0.45, ridgeW + pix * 1.2, ridgeDist)) * step(ridgeC, 0.0);
  // At night only the tallest crests break (height-keyed), as thin moonlit strokes (see xC).
  float crestGate = smoothstep(uLookB.x, uLookB.y, clamp(hN, 0.0, 1.2) * 0.85 + compress * 0.45);
  float lineCap = ridge * crestGate * (1.0 - smoothstep(0.7, 2.2, pix));
  // Storms add broad breaking patches on compressed crests, streaked along the wind.
  float stormPot = smoothstep(0.55, 0.9, compress + hN * 0.25) * uWind.w * (1.0 - smoothstep(2.0, 8.0, pix));
  vec4 fL = vec4(0.5);
  float covC = 0.0;
  if (lineCap + stormPot > 1e-3) {
    // Lagrangian samples: crest segments stretched along the crests (across the wind), storm streaks along it.
    const vec2 LS = vec2(1.0 / 16.0, 1.0 / 58.0);
    fL = textureGrad(uFoamTex, pw * LS + uFoamOff.zw, pwDx * LS, pwDy * LS);
    float seg = smoothstep(0.42, 0.66, fL.b + uWind.w * 0.14);
    float stormCap = 0.0;
    const vec2 SS = vec2(1.0 / 96.0, 1.0 / 44.0); // ~32 m long, ~1.7 m wide streaks (finer read as hatching)
    if (stormPot > 1e-3) stormCap = stormPot * smoothstep(0.25, 0.7, textureGrad(uFoamTex, pw * SS + uFoamOff.wz, pwDx * SS, pwDy * SS).a);
    covC = max(lineCap * seg, stormCap);
  }
  float coast = (1.0 - smoothstep(0.5, 6.0, shoreD)) * step(-6.0, shoreD);
  float surfPhase = fract(shoreD / 9.0 + uTime * 0.21 + fE.b * 0.4);
  float surf = smoothstep(0.7, 0.9, surfPhase) * (1.0 - smoothstep(3.0, 34.0, shoreD)) * smoothstep(0.32, 0.6, fE.b + 0.08);
  float covS = max(coast, surf * 0.9) * shoreValid;
  float covE = max(covI, covS);
  // Saturation: where the neighbourhood is mostly foam, the white collapses onto the lace network (the ridges of
  // the Worley network) and the holes fill with bright turquoise aeration. A pile-up reads as churned water with
  // lace on top, never a flat white slab with dot holes.
  float sat = smoothstep(0.3, 0.62, crowd);
  float covW = min(covE, mix(1.6, 0.3, sat));
  // Offset keeps zero coverage strictly foam-free (blob maxima never pop up as dots).
  // Large-scale patch noise varies lace density so the 26 m shape tile never reads as a repeating pattern.
  float xI = covW * 1.12 - (1.0 - fE.r) - 0.07 + (vCloud - 0.5) * 0.22 * smoothstep(0.1, 0.4, covW);
  // By day the crest foam is broken up by the foam network; at night the network's round holes read as leopard
  // spots on dark water, so crests become clean wind-aligned strokes (segment breakup only).
  float xC = covC - 0.45 + (fL.r - 0.5) * 0.3 * (1.0 - uLookC.y);
  // Sharp, fwidth-antialiased shapes up close; at distance (sub-pixel shapes) converge to the expected foam
  // fraction for the coverage instead of widening the threshold (which would invent foam from nothing).
  float aaI = fwidth(xI) * 0.85 + 0.015;
  float aaC = fwidth(xC) * 0.85 + 0.015;
  float solidI = mix(smoothstep(-aaI, aaI, xI), clamp(covW * 1.15 - 0.12, 0.0, 1.0), farBlur) * smoothstep(0.0, 0.07, covE);
  float solidC = mix(smoothstep(-aaC, aaC, xC), clamp(covC * 0.9 - 0.2, 0.0, 1.0), farBlur) * smoothstep(0.02, 0.12, covC);
  float edgeI = max(smoothstep(-0.15 - aaI, -0.15 + aaI, xI) - solidI, 0.0) * smoothstep(0.08, 0.3, covE) * (1.0 - farBlur);
  float edgeC = max(smoothstep(-0.12 - aaC, -0.12 + aaC, xC) - solidC, 0.0) * smoothstep(0.2, 0.5, covC) * (1.0 - farBlur);
  // Fringe bubbles where foam is thin (the network has mostly dissolved).
  float bub = smoothstep(0.45 - aaI, 0.55 + aaI, fE.g) * smoothstep(0.04, 0.16, covE) * (1.0 - smoothstep(0.3, 0.55, covE));
  float lace = bub * (1.0 - solidI) * (1.0 - farBlur);
  float foamSolid = max(solidI, solidC);
  float foamEdge = clamp(max(edgeI, edgeC), 0.0, 1.0) * (1.0 - foamSolid);
  // Two-tone cel foam: faces turned away from the sun (wave backs, the shadow side of the bow wave) take the
  // blue-grey shadow tone, which gives raised foam its volume.
  float foamLitK = smoothstep(-0.2, -0.08, dot(Nm, L) - L.y);
  vec3 foamLit = mix(uFoamShadow * 1.18, uFoamColor * mix(vec3(1.0), uSunColor, 0.22), foamLitK) * mix(0.55, 1.0, uLookC.w);
  // Aerated churn under a pile-up's lace: turquoise, lighter than the body, darker than foam.
  vec3 churn = mix(uSSS, uShallow, 0.45) * (0.5 + 0.5 * uLookC.w);
  col = mix(col, churn, sat * smoothstep(0.15, 0.45, covI) * 0.62);
  col = mix(col, uFoamShadow * mix(0.6, 1.0, uLookC.w), foamEdge * 0.8);
  col = mix(col, foamLit, max(foamSolid, lace));

  // ── Sun glitter path, glints (HDR, bloom-ready) and the broad sun/moon path ──
  // The path is the water whose waves can tilt far enough to mirror the sun into the eye (half-vector tilt within
  // the slope spread; wider at dusk so a low sun still draws a road at the tactical pitch). Glints live only inside
  // it: they cluster into a glittering road toward the sun instead of sparkling over the whole sea.
  vec3 Hs = normalize(L + V);
  float path = exp(-(1.0 - Hs.y) / max(uLookD.y, 1e-3)) * sunUp;
  float rl = max(dot(R, L), 0.0);
  float spec = pow(rl, Peff);
  float aaS = fwidth(spec) + 0.05;
  // Toksvig energy term: where filtered ripples widen the lobe, glints dim instead of flooding the far field.
  float toksvig = (1.0 + Peff) / (1.0 + P);
  // Fade with distance (sub-pixel glints crawl) and at a steep pitch (top-down sparkle reads as noise).
  float gFade = (1.0 - smoothstep(uLookD.z * 0.45, uLookD.z, dist)) * (1.0 - smoothstep(0.6, 2.2, pix))
    * mix(1.0, 0.4, smoothstep(0.62, 0.92, V.y));
  float glint = smoothstep(0.55 - aaS, 0.55 + aaS, spec) * toksvig * gFade * smoothstep(0.12, 0.55, path);
  // Broad sun path by day; at night a narrower moon path broken up by the ripples.
  float sheen = pow(max(dot(Rr, L), 0.0), 36.0);
  if (uLookC.y > 0.01) {
    float sheenNight = pow(max(dot(R, L), 0.0), 140.0) * 1.6 + pow(max(dot(Rr, L), 0.0), 60.0) * 0.25;
    sheen = mix(sheen, sheenNight, uLookC.y);
  }
  // At dusk the road itself glows warm, so a low sun lays a golden path even when no facet mirrors it exactly.
  sheen = max(sheen, path * uLookD.x * 0.3);
  sheen *= uLookA.y;
  // Sheen is tinted toward the horizon so a warm sun does not turn blue water lavender; glints stay sun-coloured.
  vec3 sheenCol = mix(uSunColor, uHorizon * 1.15, 0.45);
  col += (uSunColor * glint * uLookA.x + sheenCol * sheen) * sunUp * (1.0 - foamSolid * 0.85);

  // ── Night: bioluminescence only where the water was just stirred ──
  // Keyed on fresh foam (persistent B decays in under a second) and the transient layer (bow waves, Kelvin arms,
  // impact rings): fresh wake lines and impacts glow, a melee's old pile-up and the crests never do. Crowded water
  // glows less again, and the peak stays well under the enemy faction rim (materials/celMaterial.ts).
  float fresh = smoothstep(0.08, 0.45, max(pr.b, tr.b));
  float glowShape = max(max(solidI, lace), max(edgeI, 0.0) * 0.8);
  float glow = (glowShape * fresh * 0.9 + tr.a * 0.22) * (1.0 - 0.6 * sat);
  col += uBiolum * glow;

  // ── Aerial perspective (matches the linear scene fog written by the sky) ──
  float fogF = smoothstep(uFog.x, uFog.y, vViewDepth);
  col = mix(col, uFogColor, fogF);

  float alpha = 1.0;
  if (uDebug > 0.5) {
    if (uDebug < 1.5) col = vec3(tr.r, tr.g, tr.b);
    else if (uDebug < 2.5) col = vec3(pr.r, pr.g, pr.b);
    else if (uDebug < 3.5) col = vec3(shoreD / uShoreMax);
    else if (uDebug < 4.5) col = vec3(solidI, solidC, lace);
    else if (uDebug < 5.5) col = vec3(glint * toksvig, sheen, max(edgeI, 0.0));
    else if (uDebug < 6.5) col = vec3(covI, covS, covC);
    else if (uDebug < 7.5) col = vec3(crowd, sat, glow);
    else {
      // QA stats view (OceanSystem.screenStats): R = visible white foam, G = crest foam, B = glow relative to the
      // rim reference; A = 1 inside the stats disc, 0.5 outside (0 = not water).
      float foamVis = clamp(max(foamSolid, lace) + foamEdge * 0.35, 0.0, 1.0);
      float glowL = dot(uBiolum * glow, vec3(0.2126, 0.7152, 0.0722));
      col = vec3(foamVis, solidC, clamp(glowL / max(uStats.w, 1e-3), 0.0, 1.0));
      alpha = distance(vWorld.xz, uStats.xy) < uStats.z ? 1.0 : 0.5;
      gl_FragColor = vec4(col, alpha);
      return;
    }
  }
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
