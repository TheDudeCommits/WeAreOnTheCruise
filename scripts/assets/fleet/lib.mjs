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
    const m = mul(pre, node.getWorldMatrix());
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
