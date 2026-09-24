/**
 * Original heraldry for the Brightwater (SHIPS-owned), painted on 2D canvases at startup — no image files, no
 * franchise marks. Player crew: a golden sun rising over three white wave crests. Admiralty: a gold wave crest on
 * navy. Redtide Corsairs: a red sun crossed by a cutlass. Gloam Wraiths: a pale spiral eye on torn teal cloth.
 */
const INK = '#1b2340';

export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

/** Sun disc with alternating long/short rays; `half` draws only the upper half (rising sun). */
export function drawSun(ctx: Ctx, cx: number, cy: number, r: number, fill: string, rays = 12, half = false, ink = INK): void {
  ctx.save();
  if (half) { ctx.beginPath(); ctx.rect(cx - r * 3, cy - r * 3, r * 6, r * 3); ctx.clip(); }
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < rays * 2; i++) {
    const a = (i / (rays * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r * (i % 4 === 0 ? 1.85 : 1.55) : r * 1.12;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.07);
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = shade(fill, 1.12);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx - r * 0.25, cy - r * 0.28, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,240,0.35)';
  ctx.fill();
  ctx.restore();
}

/** A stylized curling wave crest (the Admiralty emblem and the player's waves). */
export function drawWaveCrest(ctx: Ctx, cx: number, cy: number, size: number, fill: string, ink = INK, flip = false): void {
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) ctx.scale(-1, 1);
  ctx.scale(size / 100, size / 100);
  ctx.beginPath();
  ctx.moveTo(-100, 40);
  ctx.bezierCurveTo(-80, 20, -60, -30, -10, -50);
  ctx.bezierCurveTo(40, -68, 90, -40, 88, 0);
  ctx.bezierCurveTo(86, 30, 50, 38, 34, 16);
  ctx.bezierCurveTo(24, 2, 36, -16, 52, -10);
  ctx.bezierCurveTo(40, -30, 0, -26, -16, 0);
  ctx.bezierCurveTo(-30, 22, -20, 38, 10, 40);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = ink;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // Foam fingers.
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const x = 58 + i * 9, y = -30 + i * 10;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 14, y - 4, x + 18, y + 8);
  }
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
}

export function drawCutlass(ctx: Ctx, cx: number, cy: number, length: number, angle: number, blade = '#e8eef2', hilt = '#d9a441', ink = INK): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const L = length;
  ctx.beginPath();
  ctx.moveTo(-L * 0.28, -L * 0.03);
  ctx.quadraticCurveTo(L * 0.25, -L * 0.1, L * 0.5, -L * 0.2);
  ctx.quadraticCurveTo(L * 0.42, L * 0.02, -L * 0.28, L * 0.05);
  ctx.closePath();
  ctx.fillStyle = blade; ctx.fill();
  ctx.lineWidth = Math.max(2, L * 0.025); ctx.strokeStyle = ink; ctx.stroke();
  ctx.beginPath();
  ctx.rect(-L * 0.32, -L * 0.1, L * 0.05, L * 0.2);
  ctx.fillStyle = hilt; ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.rect(-L * 0.5, -L * 0.03, L * 0.18, L * 0.06);
  ctx.fillStyle = '#6b3a1e'; ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.arc(-L * 0.52, 0, L * 0.04, 0, Math.PI * 2);
  ctx.fillStyle = hilt; ctx.fill(); ctx.stroke();
  ctx.restore();
}

/** Three stacked wave curls across a band (player flag). */
export function drawWaveBand(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, ink = INK): void {
  ctx.save();
  const n = 3;
  for (let i = 0; i < n; i++) {
    const cx = x + (w / n) * (i + 0.5);
    drawWaveCrest(ctx, cx, y + h * 0.5, (w / n) * 0.62, fill, ink, i % 2 === 1);
  }
  ctx.restore();
}

export function clothSeams(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, count = 6, vertical = true): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, w / 180);
  for (let i = 1; i < count; i++) {
    ctx.beginPath();
    if (vertical) { const px = x + (w * i) / count; ctx.moveTo(px, y); ctx.lineTo(px, y + h); }
    else { const py = y + (h * i) / count; ctx.moveTo(x, py); ctx.lineTo(x + w, py); }
    ctx.stroke();
  }
  ctx.restore();
}

/** Punches ragged holes and a torn edge into a region (alpha = 0). */
export function tatter(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  // Torn bottom edge.
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  for (let i = 0; i <= 12; i++) ctx.lineTo(x + (w * i) / 12, y + h - h * (0.05 + rnd() * 0.22));
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
  for (let k = 0; k < 7; k++) {
    const cx = x + w * (0.15 + rnd() * 0.7), cy = y + h * (0.15 + rnd() * 0.6), r = Math.min(w, h) * (0.04 + rnd() * 0.08);
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, rr = r * (0.6 + rnd() * 0.7);
      if (i === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k)), g = Math.min(255, Math.round(((n >> 8) & 255) * k)), b = Math.min(255, Math.round((n & 255) * k));
  return `rgb(${r},${g},${b})`;
}

export function hexCss(color: number): string { return `#${color.toString(16).padStart(6, '0')}`; }

/** The player crew flag: golden sun rising over white wave crests on a dark field, trimmed in the ship's accent. */
export function paintPlayerFlag(ctx: Ctx, x: number, y: number, w: number, h: number, accent: number): void {
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, '#1d2433'); g.addColorStop(1, '#11151f');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Accent hoist band + border.
  ctx.fillStyle = hexCss(accent);
  ctx.fillRect(x, y, w * 0.07, h);
  ctx.lineWidth = h * 0.05;
  ctx.strokeStyle = hexCss(accent);
  ctx.strokeRect(x + h * 0.025, y + h * 0.025, w - h * 0.05, h - h * 0.05);
  ctx.save();
  ctx.beginPath(); ctx.rect(x + w * 0.07, y, w * 0.93, h); ctx.clip();
  drawSun(ctx, x + w * 0.54, y + h * 0.56, h * 0.25, '#ffc233', 12, true);
  drawWaveBand(ctx, x + w * 0.12, y + h * 0.5, w * 0.84, h * 0.42, '#f4f7fb');
  ctx.restore();
  ctx.restore();
}

export function paintAdmiraltyFlag(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#1c2f63';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(x, y + h * 0.78, w, h * 0.1);
  drawWaveCrest(ctx, x + w * 0.5, y + h * 0.42, h * 0.45, '#f2c14e');
}

export function paintCorsairFlag(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#15161a';
  ctx.fillRect(x, y, w, h);
  drawSun(ctx, x + w * 0.5, y + h * 0.5, h * 0.24, '#d8342c', 10);
  drawCutlass(ctx, x + w * 0.5, y + h * 0.52, h * 0.95, -0.5);
}

export function paintWraithFlag(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  ctx.fillStyle = '#51757a';
  ctx.fillRect(x, y, w, h);
  spiralEye(ctx, x + w * 0.5, y + h * 0.48, h * 0.28);
  tatter(ctx, x, y, w, h, seed);
}

export function spiralEye(ctx: Ctx, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.strokeStyle = '#c9fff4';
  ctx.lineWidth = r * 0.14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 60; i++) {
    const t = i / 60, a = t * Math.PI * 4.2, rr = r * (1 - t * 0.85);
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.8;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

/** A long swallowtail pennant in the ship's accent colour with a gold stripe and a small sun at the hoist. */
export function paintPennant(ctx: Ctx, x: number, y: number, w: number, h: number, accent: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y + h * 0.18);
  ctx.lineTo(x + w * 0.82, y + h * 0.5);
  ctx.lineTo(x + w, y + h * 0.82);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fillStyle = hexCss(accent);
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = '#ffd35e';
  ctx.fillRect(x, y + h * 0.42, w, h * 0.16);
  ctx.fillStyle = '#1b2340';
  ctx.fillRect(x, y, w * 0.12, h);
  drawSun(ctx, x + w * 0.06, y + h * 0.5, h * 0.2, '#ffc233', 8);
  ctx.restore();
}

/** Canvas holding the hero's cloth: ensign (top-left 640×400) and pennant (bottom strip 1024×96). */
export function paintHeroClothAtlas(accent: number): { canvas: HTMLCanvasElement; ensign: [number, number, number, number]; pennant: [number, number, number, number] } {
  const { canvas, ctx } = makeCanvas(1024, 512);
  ctx.clearRect(0, 0, 1024, 512);
  paintPlayerFlag(ctx, 0, 0, 640, 400, accent);
  paintPennant(ctx, 0, 416, 1024, 96, accent);
  const uv = (px: number, py: number, pw: number, ph: number): [number, number, number, number] => [px / 1024, 1 - (py + ph) / 512, (px + pw) / 1024, 1 - py / 512];
  return { canvas, ensign: uv(2, 2, 636, 396), pennant: uv(0, 418, 1022, 92) };
}
