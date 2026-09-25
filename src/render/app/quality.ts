/**
 * Quality tiers (LOOK-owned; PERF owns the triangle budget fields). One table read by RendererHost (DPR range),
 * PostStack (MSAA, bloom, ink), SkySystem (shadows, clouds, rain density), EnemyFleet (fleet detail distance) and the
 * world's prop instancer (tree detail distance).
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
  /**
   * PERF budget: rendered triangles per frame (all passes: ink prepass, shadow map, colour, post) this tier is tuned
   * to stay under in the heaviest evidence shots. The distances below are the knobs that hold it.
   */
  triangleBudget: number;
  /** Enemy ships beyond this distance from the camera draw only hull and glow parts (m). */
  fleetDetail: number;
  /** Trees beyond this distance from the focus draw their low-detail variant (m). */
  propDetail: number;
}

export const QUALITY_PROFILES: Readonly<Record<QualityTier, QualityProfile>> = {
  low: { tier: 'low', dprMin: 0.75, dprMax: 1.0, msaa: 0, bloomLevels: 3, ink: true, shadows: false, shadowMapSize: 1024, shadowReach: 260, clouds: 0.5, rain: 0.4, triangleBudget: 1.5e6, fleetDetail: 110, propDetail: 180 },
  medium: { tier: 'medium', dprMin: 1.0, dprMax: 1.25, msaa: 2, bloomLevels: 4, ink: true, shadows: true, shadowMapSize: 2048, shadowReach: 320, clouds: 0.75, rain: 0.7, triangleBudget: 2.0e6, fleetDetail: 140, propDetail: 240 },
  high: { tier: 'high', dprMin: 1.0, dprMax: 1.5, msaa: 4, bloomLevels: 5, ink: true, shadows: true, shadowMapSize: 2048, shadowReach: 380, clouds: 1, rain: 1, triangleBudget: 2.5e6, fleetDetail: 180, propDetail: 300 },
  ultra: { tier: 'ultra', dprMin: 1.25, dprMax: 2.0, msaa: 4, bloomLevels: 6, ink: true, shadows: true, shadowMapSize: 4096, shadowReach: 460, clouds: 1, rain: 1, triangleBudget: 3.2e6, fleetDetail: 260, propDetail: 420 },
};

export function qualityProfile(tier: QualityTier): QualityProfile {
  return QUALITY_PROFILES[tier] ?? QUALITY_PROFILES.high;
}
