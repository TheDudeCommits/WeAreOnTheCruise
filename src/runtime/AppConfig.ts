import { SEA_IDS, SHIP_IDS, type SeaId, type ShipId } from '../game/ids';

export interface AppConfig {
  seed: string;
  /** Fixed DPR 2, no adaptive quality, deterministic captures. */
  captureMode: boolean;
  /** Hide all DOM UI (clean plates). */
  showUi: boolean;
  quality: 'auto' | 'low' | 'medium' | 'high' | 'ultra';
  /** `?run=<ship>[:<sea>]` jumps straight into a run (QA). */
  autoRun: { ship: ShipId; sea: SeaId } | null;
  /** `?god=1` makes the player invulnerable (QA). */
  god: boolean;
}

export function appConfigFromLocation(location: Location = window.location): AppConfig {
  const params = new URLSearchParams(location.search);
  const quality = params.get('quality');
  const run = params.get('run');
  let autoRun: AppConfig['autoRun'] = null;
  if (run) {
    const [ship, sea] = run.split(':');
    autoRun = {
      ship: (SHIP_IDS as readonly string[]).includes(ship ?? '') ? (ship as ShipId) : 'sunlion',
      sea: (SEA_IDS as readonly string[]).includes(sea ?? '') ? (sea as SeaId) : 'sunward-shallows',
    };
  }
  return {
    seed: params.get('seed') ?? `voyage-${Date.now().toString(36)}`,
    captureMode: params.get('capture') === '1',
    showUi: params.get('hud') !== '0',
    quality: quality === 'low' || quality === 'medium' || quality === 'high' || quality === 'ultra' ? quality : 'auto',
    autoRun,
    god: params.get('god') === '1',
  };
}
