/**
 * Shader and asset warm-up (PERF-owned). Contract stub: GameApp calls warmup() while the harbor shows, so first-use
 * program compiles (FX, affixes, events, captain hulls) and boss/enemy GLB loads don't hitch the first battle.
 */
import type { GameApp } from '../../runtime/GameApp';

export async function warmup(_app: GameApp): Promise<void> {}
