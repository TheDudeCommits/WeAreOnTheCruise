/**
 * Quality tiers (LOOK-owned). One table read by RendererHost (DPR range), PostStack (MSAA, bloom, ink) and
 * SkySystem (shadows, clouds, rain density).
 */
import type { QualityTier } from '../frame';

export interface QualityProfile {
  tier: QualityTier;
  /** Adaptive device-pixel-ratio range (further clamped to the display's own DPR). */
  dprMin: number;
  dprMax: number;
  /** MSAA samples on the HDR colour target (0 = off). */
  msaa: number;
  /** Bloom mip levels (0 = bloom off). */
  bloomLevels: number;
  /** Screen-space ink (the look depends on it; only the lowest emergency tier may drop it). */
  ink: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Shadow coverage radius around the view footprint (m). */
  shadowReach: number;
  /** Cloud card count multiplier 0..1. */
  clouds: number;
  /** Rain streak count multiplier 0..1. */
  rain: number;
}

export const QUALITY_PROFILES: Readonly<Record<QualityTier, QualityProfile>> = {
  low: { tier: 'low', dprMin: 0.75, dprMax: 1.0, msaa: 0, bloomLevels: 3, ink: true, shadows: false, shadowMapSize: 1024, shadowReach: 260, clouds: 0.5, rain: 0.4 },
  medium: { tier: 'medium', dprMin: 1.0, dprMax: 1.25, msaa: 2, bloomLevels: 4, ink: true, shadows: true, shadowMapSize: 2048, shadowReach: 320, clouds: 0.75, rain: 0.7 },
  high: { tier: 'high', dprMin: 1.0, dprMax: 1.5, msaa: 4, bloomLevels: 5, ink: true, shadows: true, shadowMapSize: 2048, shadowReach: 380, clouds: 1, rain: 1 },
  ultra: { tier: 'ultra', dprMin: 1.25, dprMax: 2.0, msaa: 4, bloomLevels: 6, ink: true, shadows: true, shadowMapSize: 4096, shadowReach: 460, clouds: 1, rain: 1 },
};

export function qualityProfile(tier: QualityTier): QualityProfile {
  return QUALITY_PROFILES[tier] ?? QUALITY_PROFILES.high;
}
