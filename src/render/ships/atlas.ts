/**
 * Fleet atlas (SHIPS-owned): one 1024² canvas texture painted at startup with every enemy/boss livery — faction sails
 * with original emblems, flags, torn wraith cloth, stone, serpent scales, stern windows — so every procedural ship
 * class renders with ONE vertex-coloured toon material (1 draw call per class and hull half). Untextured parts point
 * their UVs at the white block in the bottom-right corner (WHITE_UV).
 */
import * as THREE from 'three';
import {
  clothSeams, drawCutlass, drawSun, drawWaveCrest, makeCanvas, paintAdmiraltyFlag, paintCorsairFlag, paintWraithFlag, spiralEye, tatter, type Ctx,
} from './emblems';

export type AtlasRegion =
  | 'admiraltySail' | 'admiraltyPlain' | 'corsairSail' | 'corsairPlain' | 'wraithSail' | 'sovereignSail' | 'burntSail' | 'stone'
  | 'admiraltyFlag' | 'corsairFlag' | 'wraithFlag' | 'commodoreFlag' | 'scales' | 'planks' | 'windows' | 'ironPlates' | 'white';

/** Pixel rectangles (x, y, w, h) on the 1024² canvas (y down). */
const RECTS: Record<AtlasRegion, [number, number, number, number]> = {
  admiraltySail: [0, 0, 256, 256], admiraltyPlain: [256, 0, 256, 256], corsairSail: [512, 0, 256, 256], corsairPlain: [768, 0, 256, 256],
  wraithSail: [0, 256, 256, 256], sovereignSail: [256, 256, 256, 256], burntSail: [512, 256, 256, 256], stone: [768, 256, 256, 256],
  admiraltyFlag: [0, 512, 256, 160], corsairFlag: [256, 512, 256, 160], wraithFlag: [512, 512, 256, 160], commodoreFlag: [768, 512, 256, 160],
  scales: [0, 688, 256, 256], planks: [256, 688, 256, 256], windows: [512, 688, 256, 64], ironPlates: [512, 768, 256, 256], white: [768, 768, 256, 256],
};

const PAD = 4;

/** UV rect [u0, v0, u1, v1] for a region (inset to avoid bleeding). */
export function atlasUV(region: AtlasRegion): [number, number, number, number] {
  const [x, y, w, h] = RECTS[region];
  return [(x + PAD) / 1024, 1 - (y + h - PAD) / 1024, (x + w - PAD) / 1024, 1 - (y + PAD) / 1024];
}

let texture: THREE.CanvasTexture | null = null;

export function fleetAtlas(): THREE.CanvasTexture {
  if (texture) return texture;
  const { canvas, ctx } = makeCanvas(1024, 1024);
  paintAtlas(ctx);
  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.name = 'ships:fleet-atlas';
  return texture;
}

function sailBase(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, seam: string, foot?: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  clothSeams(ctx, x, y, w, h, seam, 6, true);
  if (foot) { ctx.fillStyle = foot; ctx.fillRect(x, y + h * 0.88, w, h * 0.12); }
  ctx.strokeStyle = seam; ctx.lineWidth = 6; ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
}

function paintAtlas(ctx: Ctx): void {
  ctx.clearRect(0, 0, 1024, 1024);
  const r = RECTS;
  // Admiralty: white canvas, navy foot band, gold wave crest.
  sailBase(ctx, ...r.admiraltySail, '#f6f3ea', '#d6d0c0', '#1f3566');
  drawWaveCrest(ctx, r.admiraltySail[0] + 128, r.admiraltySail[1] + 118, 92, '#f2c14e');
  sailBase(ctx, ...r.admiraltyPlain, '#f6f3ea', '#d6d0c0');
  // Corsairs: crimson canvas, black sun crossed by a cutlass.
  sailBase(ctx, ...r.corsairSail, '#b3262b', '#8a1c20');
  drawSun(ctx, r.corsairSail[0] + 128, r.corsairSail[1] + 118, 46, '#18161a', 10, false, '#18161a');
  drawCutlass(ctx, r.corsairSail[0] + 128, r.corsairSail[1] + 122, 190, -0.55, '#f1ede4', '#d9a441', '#18161a');
  sailBase(ctx, ...r.corsairPlain, '#b3262b', '#8a1c20');
  // Wraiths: torn teal-grey cloth with a pale spiral eye.
  sailBase(ctx, ...r.wraithSail, '#6f9c98', '#4d7572');
  spiralEye(ctx, r.wraithSail[0] + 128, r.wraithSail[1] + 115, 62);
  tatter(ctx, ...r.wraithSail, 77);
  // Sovereign: white canvas, gold border, big gold crest over a sun.
  sailBase(ctx, ...r.sovereignSail, '#fbf8ef', '#e2d6b4');
  ctx.strokeStyle = '#e0a93a'; ctx.lineWidth = 16; ctx.strokeRect(r.sovereignSail[0] + 10, r.sovereignSail[1] + 10, 236, 236);
  drawSun(ctx, r.sovereignSail[0] + 128, r.sovereignSail[1] + 104, 40, '#f2c14e', 12);
  drawWaveCrest(ctx, r.sovereignSail[0] + 128, r.sovereignSail[1] + 158, 84, '#f2c14e');
  // Burnt corsair sail (fire ship).
  sailBase(ctx, ...r.burntSail, '#9c2a22', '#5a1612');
  const bx = r.burntSail[0], by = r.burntSail[1];
  const g = ctx.createRadialGradient(bx + 128, by + 200, 20, bx + 128, by + 200, 160);
  g.addColorStop(0, 'rgba(20,10,8,0.95)'); g.addColorStop(1, 'rgba(20,10,8,0)');
  ctx.fillStyle = g; ctx.fillRect(bx, by, 256, 256);
  tatter(ctx, ...r.burntSail, 131);
  // Stone blocks (forts).
  paintStone(ctx, ...r.stone);
  // Flags.
  paintAdmiraltyFlag(ctx, ...r.admiraltyFlag);
  paintCorsairFlag(ctx, ...r.corsairFlag);
  paintWraithFlag(ctx, ...r.wraithFlag, 19);
  paintCommodore(ctx, ...r.commodoreFlag);
  paintScales(ctx, ...r.scales);
  paintPlanks(ctx, ...r.planks);
  paintWindows(ctx, ...r.windows);
  paintIron(ctx, ...r.ironPlates);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(...r.white);
}

function paintStone(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#b9b3a6'; ctx.fillRect(x, y, w, h);
  let s = 5;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const rows = 8;
  for (let rI = 0; rI < rows; rI++) {
    const rh = h / rows;
    let cx = x - (rI % 2) * 20;
    while (cx < x + w) {
      const bw = 34 + rnd() * 26;
      const shade = 150 + Math.floor(rnd() * 50);
      ctx.fillStyle = `rgb(${shade},${shade - 6},${shade - 16})`;
      ctx.fillRect(cx + 2, y + rI * rh + 2, bw - 4, rh - 4);
      cx += bw;
    }
  }
}

function paintScales(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#e9eef0'; ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = '#8fa3aa'; ctx.lineWidth = 3;
  const r = 18;
  for (let row = 0; row < h / (r * 0.8) + 2; row++) {
    for (let col = 0; col < w / r + 2; col++) {
      const cx = x + col * r * 2 + (row % 2) * r, cy = y + row * r * 0.8;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    }
  }
  ctx.restore();
}

function paintPlanks(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#c99a62'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#8d6238'; ctx.lineWidth = 2;
  for (let i = 1; i < 10; i++) { ctx.beginPath(); ctx.moveTo(x + (w * i) / 10, y); ctx.lineTo(x + (w * i) / 10, y + h); ctx.stroke(); }
  for (let i = 0; i < 18; i++) { const px = x + ((i * 53) % w), py = y + ((i * 97) % h); ctx.beginPath(); ctx.moveTo(px - 12, py); ctx.lineTo(px + 12, py); ctx.stroke(); }
}

function paintWindows(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#e0b04a'; ctx.fillRect(x, y, w, h);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const wx = x + 8 + (i * (w - 16)) / n;
    ctx.fillStyle = '#2b1d14'; ctx.fillRect(wx + 3, y + 8, (w - 16) / n - 6, h - 16);
    ctx.fillStyle = '#ffc861'; ctx.fillRect(wx + 7, y + 12, (w - 16) / n - 14, h - 24);
  }
}

function paintIron(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#5a6574'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#2b313b'; ctx.lineWidth = 4;
  for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(x, y + (h * i) / 4); ctx.lineTo(x + w, y + (h * i) / 4); ctx.stroke(); }
  for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(x + (w * i) / 4, y); ctx.lineTo(x + (w * i) / 4, y + h); ctx.stroke(); }
  ctx.fillStyle = '#e5b24e';
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) if ((i + j) % 2 === 0) { ctx.beginPath(); ctx.arc(x + (w * i) / 8, y + (h * j) / 8, 4, 0, Math.PI * 2); ctx.fill(); }
}

function paintCommodore(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#1c2f63'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#c7362f'; ctx.fillRect(x, y + h * 0.4, w, h * 0.2);
  drawSun(ctx, x + w * 0.2, y + h * 0.5, h * 0.18, '#f2c14e', 10);
}
