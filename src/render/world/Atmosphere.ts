import type { WeatherKind } from '../../core/contracts';

/** One color script for water, sky, geometry fog and practical lights. */
export interface AtmospherePalette { zenith: number; horizon: number; deep: number; mid: number; crest: number; foam: number; cloud: number; shadow: number; sun: number; exposure: number; fogNear: number; fogFar: number }
const daylight: AtmospherePalette = { zenith: 0x0868d2, horizon: 0x8bc6e3, deep: 0x052d79, mid: 0x0668b1, crest: 0x1dbdbf, foam: 0xfff7dd, cloud: 0xfffbeb, shadow: 0x9399bf, sun: 0xffe5b3, exposure: 1, fogNear: 700, fogFar: 2550 };
export function atmosphereFor(weather: WeatherKind): AtmospherePalette {
  if (weather === 'night') return { ...daylight, zenith: 0x061632, horizon: 0x365779, deep: 0x041c39, mid: 0x0b3d62, crest: 0x277a91, foam: 0x9bcddd, cloud: 0x7396b9, shadow: 0x25354f, sun: 0x9bc7ff, exposure: 0.5, fogNear: 420, fogFar: 1900 };
  if (weather === 'storm' || weather === 'maelstrom') return { ...daylight, zenith: 0x253b58, horizon: 0x718d9a, deep: 0x102e4b, mid: 0x24566e, crest: 0x609b9e, foam: 0xd9e8e2, cloud: 0x929eae, shadow: 0x394258, sun: 0xc8d3d9, exposure: 0.69, fogNear: 350, fogFar: 1650 };
  if (weather === 'fog') return { ...daylight, zenith: 0x739cae, horizon: 0xbbd3d4, deep: 0x366e8a, mid: 0x528eaa, crest: 0x8cc4cb, cloud: 0xd9e0da, exposure: 0.86, fogNear: 100, fogFar: 1000 };
  return daylight;
}
