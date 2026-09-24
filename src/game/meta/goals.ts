/**
 * Goals and quests (REPLAY-owned). Contract stub: `nextGoals` lists what the harbor should point the captain at next
 * (quests in progress, unlocks within reach, the next heat level); FLOW renders them.
 */
import type { MetaProfile } from '../types';

export interface Goal {
  id: string;
  title: string;
  detail: string;
  /** 0..1 progress. */
  progress: number;
  reward?: string;
}

export function nextGoals(_profile: Readonly<MetaProfile>): Goal[] { return []; }
