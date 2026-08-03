import { DEBUG_SCENES, type DebugScene } from '../core/contracts';

export interface AppConfig {
  seed: string;
  initialScene: DebugScene;
  captureMode: boolean;
  showHud: boolean;
  quality: 'auto' | 'capture' | 'performance';
}

export function appConfigFromLocation(location: Location = window.location): AppConfig {
  const params = new URLSearchParams(location.search);
  const requestedScene = params.get('scene') ?? params.get('scenario') ?? 'calm-sailing';
  const initialScene = DEBUG_SCENES.includes(requestedScene as DebugScene)
    ? requestedScene as DebugScene
    : 'calm-sailing';
  const captureMode = params.get('capture') === '1';
  const requestedQuality = params.get('quality');
  const quality = requestedQuality === 'performance' || requestedQuality === 'capture'
    ? requestedQuality
    : captureMode ? 'capture' : 'auto';
  return {
    seed: params.get('seed') ?? 'grand-line-001',
    initialScene,
    captureMode,
    showHud: params.get('hud') !== '0',
    quality,
  };
}
