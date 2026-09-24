/** Synthetic RunState for the audio lab (AUDIO-owned). Built from the real factory so every field is valid. */
import { CONTENT } from '../../game/content';
import type { EnemyId } from '../../game/ids';
import { defaultProfile } from '../../game/meta/save';
import { createRunState } from '../../game/sim/state';
import type { EnemyState, HazardState, RunState } from '../../game/types';

export interface LabWorld {
  speed: number;
  wind: number;
  rain: number;
  waves: number;
  boost: boolean;
  fires: number;
  whirlpool: boolean;
  hour: number;
  enemies: number;
  hp: number;
  paused: boolean;
}

export function createLabRun(): RunState {
  return createRunState({ seed: 'audio-lab', shipId: 'sunlion', seaId: 'sunward-shallows', content: CONTENT, meta: defaultProfile() });
}

export function fakeEnemy(id: number, defId: EnemyId, x: number, z: number, burning = false): EnemyState {
  const def = CONTENT.enemies[defId];
  return {
    id, defId, faction: def.faction, life: 'alive', sink: 0, x, z, y: 0, heading: 0, speed: def.speed, vx: 0, vz: 0, yawRate: 0,
    roll: 0, pitch: 0, radius: def.radius, length: def.length, beam: def.radius * 2, hp: def.hp, maxHp: def.hp, armor: def.armor,
    elite: false, hitFlash: 0, hidden: 0, statuses: burning ? [{ kind: 'burning', time: 99, magnitude: 1 }] : [], attackCooldown: 3, ai: {}, spawnTime: 0,
  };
}

function hazard(id: number, kind: HazardState['kind'], x: number, z: number): HazardState {
  return { id, alive: true, kind, team: 'player', x, z, radius: 30, ttl: 99, age: 0, damage: 0, tick: 0, tickTimer: 0, vx: 0, vz: 0, armed: true };
}

const ENEMY_MIX: EnemyId[] = ['skiff', 'cutter', 'brig', 'frigate', 'corsair-brig', 'man-o-war'];

/** Applies the lab sliders to the synthetic run (called every frame). */
export function applyLabWorld(run: RunState, w: LabWorld, time: number): void {
  const p = run.player;
  run.status = w.paused ? 'paused' : 'running';
  run.time = time;
  p.speed = w.speed;
  p.hp = p.maxHp * w.hp;
  p.skills.boost.active = w.boost ? 1 : 0;
  run.sea.windStrength = w.wind;
  run.sea.rain = w.rain;
  run.sea.waveScale = w.waves;
  run.sea.timeOfDay = w.hour;
  run.sea.weather = w.rain > 0.4 ? 'storm' : w.wind > 0.65 ? 'breezy' : 'clear';
  // Enemies ring (drives the music intensity meter) + burning ones (fire loops).
  const want = Math.max(w.enemies, w.fires);
  if (run.enemies.length !== want) {
    run.enemies.length = 0;
    for (let i = 0; i < want; i++) {
      const a = (i / Math.max(1, want)) * Math.PI * 2 + 0.4, r = 90 + (i % 5) * 45;
      run.enemies.push(fakeEnemy(1000 + i, ENEMY_MIX[i % ENEMY_MIX.length]!, Math.sin(a) * r, Math.cos(a) * r, false));
    }
  }
  run.enemies.forEach((e, i) => { e.statuses = i < w.fires ? [{ kind: 'burning', time: 99, magnitude: 1 }] : []; });
  const hasPool = run.hazards.some((h) => h.kind === 'whirlpool');
  if (w.whirlpool && !hasPool) run.hazards.push(hazard(5000, 'whirlpool', -120, -60));
  if (!w.whirlpool && hasPool) run.hazards = run.hazards.filter((h) => h.kind !== 'whirlpool');
}
