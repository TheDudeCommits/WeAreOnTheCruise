import * as THREE from 'three';
import type { ShipPalette } from '../content';
import type { ShipKind } from '../core/contracts';
import { attachInvertedHullOutline, createDoubleSidedCelMaterial, setOutlineViewport } from '../render/npr';
import { surfaceTexture } from '../render/npr/surfaceTextures';
import type { ProceduralShipModel, ShipMaterialSet } from '../render/ships';

export function createShipMaterialSet(
  _kind: ShipKind,
  palette: ShipPalette,
  owned: Set<THREE.Material>,
): ShipMaterialSet {
  const cel = (color: number, rimColor = 0xa9f4ff, shadowTint = 0x7e819d, surface?: 'wood' | 'cloth'): THREE.Material => {
    const material = createDoubleSidedCelMaterial({
      color,
      surfaceMap: surface === 'wood' ? surfaceTexture('painted-timber') : undefined,
      surfaceScale: .28,
      surfaceStrength: .24,
      cloth: surface === 'cloth',
      shadowTint,
      highlightTint: 0xfff0d6,
      rimColor,
      rimStrength: 0.12,
      rimThreshold: 0.88,
      specularThreshold: 0.99,
      bandThresholds: [0.31, 0.56, 0.8],
      horizonColor: 0x75c8db,
      fogNear: 650,
      fogFar: 2_600,
    });
    owned.add(material);
    return material;
  };
  const ink = new THREE.MeshBasicMaterial({ color: 0x101522, side: THREE.DoubleSide });
  owned.add(ink);
  const readableHull = liftDarkColor(palette.hull, 0.2);
  const readableHullDark = liftDarkColor(palette.hullDark, 0.245);
  const cabinColor = liftDarkColor(
    new THREE.Color(readableHullDark).lerp(new THREE.Color(readableHull), 0.18).getHex(),
    0.29,
  );
  return {
    hull: cel(readableHull, 0xffedc4, 0x7e819d, 'wood'),
    hullDark: cel(readableHullDark, 0x6d9bc0, 0x626980, 'wood'),
    cabin: cel(cabinColor, 0x8fc7db, 0x7a758a, 'wood'),
    trim: cel(palette.trim, 0xfff0a8),
    sail: cel(palette.sail, 0xffffff, 0x7e819d, 'cloth'),
    accent: cel(palette.accent, 0xffd682),
    metal: cel(palette.metal, 0x92dbed),
    glass: cel(0x63c9dc, 0xd8ffff, 0x537d9b),
    ink,
    skin: cel(0xd99868, 0xffd4a0),
    white: cel(0xf2ead6, 0xffffff),
  };
}

/** Raises only the value floor, retaining each ship's authored hue and saturation. */
function liftDarkColor(color: number, minimumLightness: number): number {
  const lifted = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  lifted.getHSL(hsl);
  lifted.setHSL(hsl.h, Math.min(0.82, hsl.s), Math.max(minimumLightness, hsl.l));
  return lifted.getHex();
}

/** Adds actual inverted-hull shells once per generated model. */
export function ensureShipInk(model: ProceduralShipModel, width: number, height: number): void {
  if (model.root.userData.inkReady === true) {
    setOutlineViewport(model.root, width, height);
    return;
  }
  const meshes: THREE.Mesh[] = [];
  model.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.isInvertedHullOutline === true) return;
    if (object instanceof THREE.InstancedMesh) return;
    object.geometry.computeBoundingSphere();
    if ((object.geometry.boundingSphere?.radius ?? 0) < 0.22) return;
    meshes.push(object);
  });
  for (const mesh of meshes) {
    attachInvertedHullOutline(mesh, {
      color: 0x101522,
      thicknessPixels: mesh.name === 'hull' ? 2.8 : 1.7,
      viewportWidth: width,
      viewportHeight: height,
    });
  }
  model.root.userData.inkReady = true;
}
