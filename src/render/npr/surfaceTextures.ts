import { ClampToEdgeWrapping, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three';

const loader = new TextureLoader();
const textures = new Map<string, Texture>();
const pending: Promise<unknown>[] = [];

/** Original imagegen material and sky artwork, shared and mipmapped in the real renderer. */
export function surfaceTexture(name: 'limestone' | 'painted-timber' | 'cinematic-sky'): Texture {
  const existing = textures.get(name);
  if (existing) return existing;
  let settle: () => void = () => {};
  pending.push(new Promise<void>((resolve) => { settle = resolve; }));
  const texture = loader.load(`/assets/materials/${name}.png`, () => { texture.userData.loaded = true; settle(); }, undefined, () => { texture.userData.failed = true; settle(); });
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = name === 'cinematic-sky' ? ClampToEdgeWrapping : RepeatWrapping;
  texture.anisotropy = 4;
  texture.name = `AuthoredAnimeSurface:${name}`;
  textures.set(name, texture);
  return texture;
}
export async function readySurfaceTextures(): Promise<void> { await Promise.all(pending); }
export function disposeSurfaceTextures(): void { for (const texture of textures.values()) texture.dispose(); textures.clear(); pending.length = 0; }
