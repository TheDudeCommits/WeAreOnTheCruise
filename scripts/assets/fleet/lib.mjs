/**
 * Geometry / texture helpers for the fleet pipeline (build-fleet.mjs).
 * Coordinate contract of every output GLB: +Y up, bow/forward toward −Z, origin at the waterline centre (ships)
 * or ground centre (props, crew, nature), metres.
 */
import { core, fn, sharp } from './tools.mjs';

// ───────────────────────────── 4×4 column-major matrices (glTF convention) ─────────────────────────────
export const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}
export function rotY(deg) { const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; }
export function rotX(deg) { const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; }
export function rotZ(deg) { const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
export function scale(s) { return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]; }
export function translate(x, y, z) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; }
export function apply(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

/** Mesh nodes of the default scene (after flatten these are direct scene children). */
export function meshNodes(doc) {
  const out = [];
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  scene.traverse((n) => { if (n.getMesh()) out.push(n); });
  return out;
}

/** World-space AABB of all mesh vertices after applying `pre` (a matrix applied on top of each node's world matrix). */
export function boundsWith(doc, pre = I4()) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const node of meshNodes(doc)) {
    const m = mul(pre, bindMatrix(node));
    for (const prim of node.getMesh().listPrimitives()) {
      const pos = prim.getAttribute('POSITION'); if (!pos) continue;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v); const p = apply(m, v[0], v[1], v[2]);
        for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
      }
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
}

/** World matrix that places a mesh's vertices in bind pose (skinned meshes ignore their node transform in glTF). */
export function bindMatrix(node) {
  const skin = node.getSkin && node.getSkin();
  if (!skin) return node.getWorldMatrix();
  const joint = skin.listJoints()[0]; const ibm = skin.getInverseBindMatrices();
  if (!joint || !ibm) return node.getWorldMatrix();
  const inv = new Array(16).fill(0); ibm.getElement(0, inv);
  return mul(joint.getWorldMatrix(), inv);
}

/** Bake `pre × world` into every static mesh; leaves identity node transforms. Shared meshes are cloned. */
export function bakeTransforms(doc, pre) {
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const seen = new Map();
  for (const node of meshNodes(doc)) {
    let mesh = node.getMesh();
    if (seen.has(mesh)) { mesh = mesh.clone(); node.setMesh(mesh); }
    seen.set(mesh, true);
    const m = mul(pre, node.getWorldMatrix());
    // clone accessors so shared vertex data is not transformed twice
    for (const prim of mesh.listPrimitives()) {
      for (const sem of prim.listSemantics()) { const a = prim.getAttribute(sem); if (a.listParents().filter((p) => p.propertyType === 'Primitive').length > 1) prim.setAttribute(sem, a.clone()); }
    }
    fn.transformMesh(mesh, m);
    // reparent to scene root with identity transform
    node.setMatrix(I4());
    if (node.getParentNode && node.getParentNode()) { node.getParentNode().removeChild(node); scene.addChild(node); }
  }
  // drop empty transform-only nodes
  for (const n of doc.getRoot().listNodes()) if (!n.getMesh() && !n.getSkin() && !n.getCamera() && n.listChildren().length === 0) n.dispose();
}

/** Iterate triangles of a primitive: cb(i0,i1,i2) with vertex indices. */
export function forTriangles(prim, cb) {
  const idx = prim.getIndices(); const n = idx ? idx.getCount() : prim.getAttribute('POSITION').getCount();
  const get = idx ? (i) => idx.getScalar(i) : (i) => i;
  for (let t = 0; t + 2 < n; t += 3) cb(get(t), get(t + 1), get(t + 2), t / 3);
}

/**
 * Move triangles of `prim` for which pred({a,b,c,centroid,normal}) is true into a new primitive using `material`.
 * Positions are read as stored (call after bakeTransforms so they are world metres). Returns number moved.
 */
export function splitPrimitive(doc, mesh, prim, pred, material) {
  const pos = prim.getAttribute('POSITION');
  const keep = [], move = [];
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
  forTriangles(prim, (i0, i1, i2) => {
    pos.getElement(i0, A); pos.getElement(i1, B); pos.getElement(i2, C);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const tri = { a: [...A], b: [...B], c: [...C], centroid: [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3], normal: [nx, ny, nz], area: l / 2 };
    (pred(tri) ? move : keep).push(i0, i1, i2);
  });
  if (!move.length) return 0;
  const mk = (list) => { const a = doc.createAccessor().setType('SCALAR').setArray(pos.getCount() > 65535 ? new Uint32Array(list) : new Uint16Array(list)); const b = prim.getIndices()?.getBuffer() || doc.getRoot().listBuffers()[0]; if (b) a.setBuffer(b); return a; };
  const moved = prim.clone(); moved.setIndices(mk(move)); moved.setMaterial(material); mesh.addPrimitive(moved);
  if (keep.length) prim.setIndices(mk(keep)); else { mesh.removePrimitive(prim); prim.dispose(); }
  return move.length / 3;
}

// ───────────────────────────── textures ─────────────────────────────
export async function decode(tex) {
  const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { px: data, w: info.width, h: info.height };
}
export async function encode(tex, img) {
  const png = await sharp(img.px, { raw: { width: img.w, height: img.h, channels: 4 } }).png().toBuffer();
  tex.setImage(new Uint8Array(png)).setMimeType('image/png');
  const uri = tex.getURI(); if (uri) tex.setURI(uri.replace(/\.(jpe?g|webp)$/i, '.png'));
}
/** In-place per-pixel edit: f(r,g,b,a,x,y) → [r,g,b,a] | null (null = unchanged). */
export async function editTexture(tex, f) {
  const img = await decode(tex);
  const { px, w, h } = img;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; const r = f(px[o], px[o + 1], px[o + 2], px[o + 3], x, y);
    if (r) { px[o] = r[0]; px[o + 1] = r[1]; px[o + 2] = r[2]; if (r.length > 3) px[o + 3] = r[3]; }
  }
  await encode(tex, img);
}
/** Composite an SVG (or PNG buffer) over a texture at pixel rect {left, top, width, height}. */
export async function overlay(tex, input, rect) {
  const base = Buffer.from(tex.getImage());
  const layer = await sharp(Buffer.from(input)).resize(Math.round(rect.width), Math.round(rect.height), { fit: 'fill' }).png().toBuffer();
  const out = await sharp(base).composite([{ input: layer, left: Math.round(rect.left), top: Math.round(rect.top) }]).png().toBuffer();
  tex.setImage(new Uint8Array(out)).setMimeType('image/png');
}
export const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
export function hex(c) { const v = parseInt(c.replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
/** Luminance → colour ramp. stops: [[t0,'#hex'],[t1,'#hex']...] with t in 0..1. */
export function ramp(stops) {
  const s = stops.map(([t, c]) => [t, hex(c)]);
  return (l) => {
    const t = Math.max(0, Math.min(1, l / 255));
    for (let i = 1; i < s.length; i++) if (t <= s[i][0]) { const [t0, c0] = s[i - 1], [t1, c1] = s[i]; const k = (t - t0) / Math.max(1e-6, t1 - t0); return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k)); }
    return s[s.length - 1][1];
  };
}
export function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return [h * 360, s, l];
}
export function hsl2rgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360; if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}

/** Rasterise the UV triangles of the given primitives into a w×h mask (1 = covered). */
export function uvMask(prims, w, h, triFilter = null) {
  const mask = new Uint8Array(w * h);
  for (const prim of prims) {
    const uv = prim.getAttribute('TEXCOORD_0'); if (!uv) continue; const pos = prim.getAttribute('POSITION');
    const a = [0, 0], b = [0, 0], c = [0, 0], A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
    forTriangles(prim, (i0, i1, i2) => {
      if (triFilter) { pos.getElement(i0, A); pos.getElement(i1, B); pos.getElement(i2, C); if (!triFilter(A, B, C)) return; }
      uv.getElement(i0, a); uv.getElement(i1, b); uv.getElement(i2, c);
      const P = [a, b, c].map(([u, v]) => [(((u % 1) + 1) % 1) * w, (((v % 1) + 1) % 1) * h]);
      const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])) - 1), maxX = Math.min(w - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])) + 1);
      const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])) - 1), maxY = Math.min(h - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])) + 1);
      const ed = (p, q, x, y) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
      const area = ed(P[0], P[1], P[2][0], P[2][1]); if (Math.abs(area) < 1e-9) return;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ed(P[1], P[2], px, py), w1 = ed(P[2], P[0], px, py), w2 = ed(P[0], P[1], px, py);
        const e = Math.abs(area) * 0.02; // small dilation
        if ((area > 0 && w0 >= -e && w1 >= -e && w2 >= -e) || (area < 0 && w0 <= e && w1 <= e && w2 <= e)) mask[y * w + x] = 1;
      }
    });
  }
  return mask;
}

/** A copy of `mat` (and its base colour texture) so part of a mesh can be recoloured independently. */
export function cloneMaterial(doc, mat, name) {
  const m = mat.clone().setName(name);
  const t = mat.getBaseColorTexture();
  if (t) { const t2 = t.clone().setName(`${name}-albedo`); if (t.getURI()) t2.setURI(`${name}-albedo.png`); m.setBaseColorTexture(t2); }
  return m;
}

// ───────────────────────────── sails with faction emblems ─────────────────────────────
/**
 * Move the triangles chosen by `select(tri, info)` into a new material textured with `svg` and give them planar UVs
 * per connected sail (projected on the sail plane, aspect preserved, emblem centred).
 * layout 'halves': the texture's left half carries the emblem (large sails), right half is plain canvas (small sails).
 * layout 'full': the whole texture is used for every piece (flags).
 * info = { mesh, material, uv:[u,v] | null, texel: ([u,v]) => [r,g,b] | null }.
 */
export async function sailify(doc, { select, svg, name, layout = 'halves', emblemMinShare = 0.18, texSize = [1024, 512] }) {
  const png = await sharp(Buffer.from(svg)).resize(texSize[0], texSize[1], { fit: 'fill' }).png().toBuffer();
  const tex = doc.createTexture(`${name}-albedo`).setImage(new Uint8Array(png)).setMimeType('image/png').setURI(`${name}-albedo.png`);
  const mat = doc.createMaterial(name).setBaseColorTexture(tex).setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(1);
  const texCache = new Map();
  const texelFor = async (m) => {
    const t = m?.getBaseColorTexture(); if (!t) return null;
    if (!texCache.has(t)) texCache.set(t, await decode(t));
    const img = texCache.get(t);
    return ([u, v]) => { const x = Math.min(img.w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * img.w))), y = Math.min(img.h - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * img.h))); const o = (y * img.w + x) * 4; return [img.px[o], img.px[o + 1], img.px[o + 2]]; };
  };
  let moved = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of [...mesh.listPrimitives()]) {
    if (prim.getMaterial() === mat) continue;
    const uvA = prim.getAttribute('TEXCOORD_0'); const texel = await texelFor(prim.getMaterial());
    const U0 = [0, 0], U1 = [0, 0], U2 = [0, 0]; const posA = prim.getAttribute('POSITION');
    // map triangles to their uv centroid via a side table keyed by first index
    const uvOf = new Map();
    if (uvA) forTriangles(prim, (a, b, c) => { uvA.getElement(a, U0); uvA.getElement(b, U1); uvA.getElement(c, U2); uvOf.set(`${a},${b},${c}`, [(U0[0] + U1[0] + U2[0]) / 3, (U0[1] + U1[1] + U2[1]) / 3]); });
    const idx = []; forTriangles(prim, (a, b, c) => idx.push([a, b, c]));
    let k = 0;
    moved += splitPrimitive(doc, mesh, prim, (tri) => { const [a, b, c] = idx[k++]; const uv = uvOf.get(`${a},${b},${c}`) || null; return select(tri, { mesh: mesh.getName(), material: prim.getMaterial()?.getName() || '', uv, texel: texel && uv ? texel(uv) : null }); }, mat);
    void posA;
  }
  if (!moved) { mat.dispose(); tex.dispose(); return 0; }
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) if (prim.getMaterial() === mat) planarSailUVs(doc, prim, layout, emblemMinShare);
  return moved;
}

function planarSailUVs(doc, prim, layout, emblemMinShare) {
  fn.compactPrimitive(prim);
  const pos = prim.getAttribute('POSITION'); const n = pos.getCount(); const v = [0, 0, 0];
  const P = []; for (let i = 0; i < n; i++) { pos.getElement(i, v); P.push([...v]); }
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const byKey = new Map();
  for (let i = 0; i < n; i++) { const kk = P[i].map((x) => Math.round(x * 100)).join(','); if (byKey.has(kk)) union(i, byKey.get(kk)); else byKey.set(kk, i); }
  const tris = []; forTriangles(prim, (a, b, c) => { union(a, b); union(b, c); tris.push([a, b, c]); });
  const comps = new Map();
  for (const [a, b, c] of tris) {
    const r = find(a); if (!comps.has(r)) comps.set(r, { verts: new Set(), nrm: [0, 0, 0], area: 0 });
    const C = comps.get(r); C.verts.add(a); C.verts.add(b); C.verts.add(c);
    const ux = P[b][0] - P[a][0], uy = P[b][1] - P[a][1], uz = P[b][2] - P[a][2], wx = P[c][0] - P[a][0], wy = P[c][1] - P[a][1], wz = P[c][2] - P[a][2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    // orient face normals consistently before accumulating (double-sided sails have both windings)
    const ref = Math.abs(nz) >= Math.abs(nx) ? nz : nx; if (ref < 0) { nx = -nx; ny = -ny; nz = -nz; }
    C.nrm[0] += nx; C.nrm[1] += ny; C.nrm[2] += nz; C.area += Math.hypot(nx, ny, nz) / 2;
  }
  const maxArea = Math.max(...[...comps.values()].map((c) => c.area));
  const uv = new Float32Array(n * 2);
  for (const C of comps.values()) {
    let [nx, ny, nz] = C.nrm; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // u = horizontal axis in the sail plane, v = up
    let ux = ny * 0 - nz * 1, uz = nx * 1 - ny * 0, uy = 0; // cross(n, Y)
    let ul = Math.hypot(ux, uy, uz); if (ul < 1e-3) { ux = 1; uz = 0; ul = 1; } ux /= ul; uz /= ul;
    if (Math.abs(nz) >= Math.abs(nx) ? ux < 0 : uz > 0) { ux = -ux; uz = -uz; }
    const vx = uy * nz - uz * ny, vy = uz * nx - ux * nz, vz = ux * ny - uy * nx; // cross(u, n)
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    for (const i of C.verts) { const pu = P[i][0] * ux + P[i][2] * uz, pv = P[i][0] * vx + P[i][1] * vy + P[i][2] * vz; umin = Math.min(umin, pu); umax = Math.max(umax, pu); vmin = Math.min(vmin, pv); vmax = Math.max(vmax, pv); }
    const w = Math.max(1e-6, umax - umin), h = Math.max(1e-6, vmax - vmin), side = Math.max(w, h);
    const emblem = layout === 'full' || (C.area >= maxArea * emblemMinShare && Math.min(w, h) / side > 0.42);
    for (const i of C.verts) {
      const pu = P[i][0] * ux + P[i][2] * uz, pv = P[i][0] * vx + P[i][1] * vy + P[i][2] * vz;
      let s, t;
      if (layout === 'full') { s = (pu - umin) / w; t = 1 - (pv - vmin) / h; }
      else if (emblem) { s = 0.5 + (pu - (umin + umax) / 2) / side; t = 0.5 - (pv - (vmin + vmax) / 2) / side; s = 0.01 + s * 0.48; t = 0.01 + t * 0.98; }
      else { s = 0.51 + ((pu - umin) / w) * 0.48; t = 0.01 + (1 - (pv - vmin) / h) * 0.98; }
      uv[i * 2] = s; uv[i * 2 + 1] = t;
    }
  }
  const acc = doc.createAccessor().setType('VEC2').setArray(uv); const buf = pos.getBuffer(); if (buf) acc.setBuffer(buf);
  prim.setAttribute('TEXCOORD_0', acc);
  for (const sem of prim.listSemantics()) if (/^TEXCOORD_[1-9]|^COLOR_/.test(sem)) prim.setAttribute(sem, null);
}

/** Append a primitive built from raw arrays (positions xyz, uvs uv, indices) with `material` to the first mesh. */
export function addGeometry(doc, { positions, uvs, indices, material, name = 'added' }) {
  const buf = doc.getRoot().listBuffers()[0] || doc.createBuffer();
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setMaterial(material)
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buf));
  if (uvs) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buf));
  // flat normals are fine for toon shading; compute per-vertex from faces
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3], vy = positions[c * 3 + 1] - positions[a * 3 + 1], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i * 3] += nx; n[i * 3 + 1] += ny; n[i * 3 + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(n).setBuffer(buf));
  let mesh = doc.getRoot().listMeshes()[0];
  if (!mesh) { mesh = doc.createMesh(name); const node = doc.createNode(name).setMesh(mesh); (doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0]).addChild(node); }
  mesh.addPrimitive(prim);
  return prim;
}

/** Box geometry arrays (axis aligned, min/max corners) appended into acc {positions, indices}. */
export function pushBox(acc, [x0, y0, z0], [x1, y1, z1]) {
  const base = acc.positions.length / 3;
  const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  // duplicate vertices per face for hard edges
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
  for (const f of faces) { const b = acc.positions.length / 3; for (const i of f) acc.positions.push(...P[i]); acc.uvs?.push(0.9, 0.5, 0.95, 0.5, 0.95, 0.55, 0.9, 0.55); acc.indices.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  return base;
}

// ───────────────────────────── texture atlas (draw-call reduction) ─────────────────────────────
/**
 * Merge textured materials that share alphaMode/doubleSided into one material with a packed atlas (≤ size²).
 * Tiled UVs are supported by pre-tiling each source texture over its integer UV range (max 4×4 tiles).
 * Materials with emissive maps are left alone. Call before join(); returns the number of materials merged.
 */
export async function atlasMaterials(doc, { size = 1024, pad = 6, maxTiles = 4 } = {}) {
  const root = doc.getRoot();
  const usage = new Map(); // material -> prims
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) { const m = p.getMaterial(); if (!m) continue; if (!usage.has(m)) usage.set(m, []); usage.get(m).push(p); }
  const buckets = new Map();
  for (const [m, prims] of usage) {
    const t = m.getBaseColorTexture(); if (!t || m.getEmissiveTexture()) continue;
    if (prims.some((p) => !p.getAttribute('TEXCOORD_0'))) continue;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity; const uv = [0, 0];
    for (const p of prims) { const a = p.getAttribute('TEXCOORD_0'); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, uv); u0 = Math.min(u0, uv[0]); u1 = Math.max(u1, uv[0]); v0 = Math.min(v0, uv[1]); v1 = Math.max(v1, uv[1]); } }
    const fu0 = Math.floor(u0 + 1e-3), fv0 = Math.floor(v0 + 1e-3);
    const tu = Math.max(1, Math.ceil(u1 - 1e-3) - fu0), tv = Math.max(1, Math.ceil(v1 - 1e-3) - fv0);
    if (tu > maxTiles || tv > maxTiles) continue;
    const key = `${m.getAlphaMode()}|${m.getDoubleSided()}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ m, prims, t, fu0, fv0, tu, tv, sz: t.getSize() });
  }
  let merged = 0;
  for (const items of buckets.values()) {
    if (items.length < 2) continue;
    // shelf pack at a scale that fits size×size
    const area = items.reduce((a, it) => a + it.sz[0] * it.tu * it.sz[1] * it.tv, 0);
    let s = Math.min(1, size / Math.sqrt(area * 1.15)), layout = null;
    for (let tries = 0; tries < 40 && !layout; tries++, s *= 0.93) {
      const rects = items.map((it) => ({ it, w: Math.max(8, Math.floor(it.sz[0] * it.tu * s)), h: Math.max(8, Math.floor(it.sz[1] * it.tv * s)) })).sort((a, b) => b.h - a.h);
      let x = 0, y = 0, rowH = 0, ok = rects.every((r) => r.w + 2 * pad <= size && r.h + 2 * pad <= size);
      for (const r of ok ? rects : []) {
        if (x + r.w + 2 * pad > size) { x = 0; y += rowH; rowH = 0; }
        r.x = x + pad; r.y = y + pad; x += r.w + 2 * pad; rowH = Math.max(rowH, r.h + 2 * pad);
        if (y + rowH > size) { ok = false; break; }
      }
      if (ok) layout = rects;
    }
    if (!layout) continue;
    const comps = [];
    for (const r of layout) {
      const { it } = r;
      const tile = await sharp(Buffer.from(it.t.getImage())).ensureAlpha().png().toBuffer();
      const tiles = []; for (let j = 0; j < it.tv; j++) for (let i = 0; i < it.tu; i++) tiles.push({ input: tile, left: i * it.sz[0], top: j * it.sz[1] });
      const big = await sharp({ create: { width: it.sz[0] * it.tu, height: it.sz[1] * it.tv, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(tiles).png().toBuffer();
      const fitted = await sharp(big).resize(r.w, r.h, { fit: 'fill', kernel: 'lanczos3' }).extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: 'copy' }).png().toBuffer();
      comps.push({ input: fitted, left: r.x - pad, top: r.y - pad });
    }
    const atlasPng = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 255 } } }).composite(comps).png().toBuffer();
    const first = layout[0].it.m;
    const tex = doc.createTexture(`${first.getName()}-atlas`).setImage(new Uint8Array(atlasPng)).setMimeType('image/png').setURI(`${first.getName()}-atlas.png`);
    const mat = first.clone().setName(`${first.getName()}-atlas`).setBaseColorTexture(tex).setBaseColorFactor([1, 1, 1, 1]);
    for (const r of layout) {
      const { it } = r;
      const f = it.m.getBaseColorFactor();
      if (Math.abs(f[0] - 1) + Math.abs(f[1] - 1) + Math.abs(f[2] - 1) > 0.02) continue; // tinted materials stay separate
      for (const p of it.prims) {
        const a = p.getAttribute('TEXCOORD_0').clone(); const uv = [0, 0];
        for (let i = 0; i < a.getCount(); i++) {
          a.getElement(i, uv);
          const lu = (uv[0] - it.fu0) / it.tu, lv = (uv[1] - it.fv0) / it.tv;
          a.setElement(i, [(r.x + lu * r.w) / size, (r.y + lv * r.h) / size]);
        }
        p.setAttribute('TEXCOORD_0', a).setMaterial(mat);
      }
      merged++;
    }
  }
  return merged;
}
