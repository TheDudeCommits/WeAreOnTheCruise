import type { AmmoKind, ShipKind, ShipSide } from '../core/contracts';

/**
 * Presentation-only messages emitted by the simulation adapter. They deliberately
 * carry no authoritative state: the HUD always reads durable values from WorldState.
 */
export type PresentationEvent =
  | {
      type: 'cannon-fired';
      shipId?: string;
      shipKind?: ShipKind;
      side?: ShipSide;
      ammo?: AmmoKind;
      weight?: number;
    }
  | {
      type: 'impact';
      targetId?: string;
      section?: ShipSide;
      severity?: number;
      material?: 'hull' | 'water' | 'mast' | 'reef';
    }
  | {
      type: 'damage';
      targetId?: string;
      section?: ShipSide;
      severity?: number;
    }
  | {
      type: 'special';
      shipId?: string;
      shipKind?: ShipKind;
      phase?: 'charge' | 'fire' | 'ready';
      name?: string;
      power?: number;
    }
  | { type: 'race-countdown'; count: number }
  | { type: 'race-start' }
  | { type: 'checkpoint'; index?: number; total?: number }
  | { type: 'victory'; title?: string; subtitle?: string }
  | { type: 'defeat'; title?: string; subtitle?: string }
  | { type: 'discovery'; title: string; subtitle?: string }
  | {
      type: 'crew-callout';
      speaker?: string;
      message: string;
      tone?: 'info' | 'danger' | 'success' | 'race';
    }
  | { type: 'target-acquired'; targetId?: string; name?: string }
  | { type: 'repair'; phase: 'start' | 'tick' | 'complete' }
  | { type: 'thunder'; strength?: number };

