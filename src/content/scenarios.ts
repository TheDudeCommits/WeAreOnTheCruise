import type {
  AiCombatRole,
  AiPersonality,
  DebugScene,
  GameMode,
  ShipFaction,
  ShipKind,
  Vec3,
  WeatherKind,
} from '../core/contracts';

export interface ScenarioShip {
  id: string;
  kind: ShipKind;
  position: Vec3;
  heading: number;
  ai?: AiPersonality;
  faction?: ShipFaction;
  combatRole?: AiCombatRole;
  name?: string;
  damage?: number;
}

export interface ScenarioIsland {
  id: string;
  position: Vec3;
  radius: number;
  height: number;
  palette: number;
  landmark: 'volcano' | 'arches' | 'palms' | 'fort' | 'needles';
  discovered?: boolean;
}

export interface ScenarioPreset {
  scene: DebugScene;
  mode: GameMode;
  weather: WeatherKind;
  objective: string;
  windDirection: number;
  windStrength: number;
  currentDirection: number;
  currentStrength: number;
  player: ScenarioShip;
  rivals: readonly ScenarioShip[];
  islands: readonly ScenarioIsland[];
  raceCourse?: readonly Vec3[];
  raceCountdown?: number;
  bounty?: number;
  timeOfDay?: number;
}

const v = (x: number, z: number, y = 0): Vec3 => ({ x, y, z });

const CIRCUIT: readonly Vec3[] = [
  v(0, 30), v(-90, -95), v(-250, -120), v(-370, 10), v(-290, 165),
  v(-95, 205), v(80, 145), v(160, 20), v(105, -115), v(-20, -135),
];

const ROUGH_CIRCUIT: readonly Vec3[] = [
  v(0, 25), v(-120, -85), v(-320, -55), v(-395, 105), v(-245, 235),
  v(-50, 170), v(80, 265), v(255, 150), v(205, -25), v(70, -145),
];

const raceRivals = (): readonly ScenarioShip[] => [
  { id: 'rival-red', kind: 'red-force', position: v(-30, 70), heading: 0, ai: 'tactical' },
  { id: 'rival-merry', kind: 'going-merry', position: v(30, 82), heading: 0, ai: 'reckless' },
  { id: 'rival-polar', kind: 'polar-tang', position: v(90, 72), heading: 0, ai: 'racer' },
];

export const SCENARIO_PRESETS: Readonly<Record<DebugScene, ScenarioPreset>> = {
  'calm-sailing': {
    scene: 'calm-sailing', mode: 'explore', weather: 'calm', objective: 'Navigate the rival fleets toward Dawn Archipelago',
    windDirection: 0.35, windStrength: 0.72, currentDirection: -0.2, currentStrength: 0.22,
    player: { id: 'player', kind: 'thousand-sunny', position: v(0, 0), heading: 0, faction: 'straw-hat' },
    rivals: [
      { id: 'merry-escort', name: 'Going Merry', kind: 'going-merry', position: v(-85, -135), heading: 0.1, ai: 'tactical', faction: 'straw-hat', combatRole: 'escort' },
      { id: 'red-force-roamer', name: 'Red Force', kind: 'red-force', position: v(260, -210), heading: 0.65, ai: 'tactical', faction: 'red-hair', combatRole: 'broadside' },
      { id: 'moby-roamer', name: 'Moby Dick', kind: 'moby-dick', position: v(-380, -300), heading: -0.25, ai: 'aggressive', faction: 'whitebeard', combatRole: 'rammer' },
      { id: 'polar-roamer', name: 'Polar Tang', kind: 'polar-tang', position: v(180, -310), heading: 0.15, ai: 'reckless', faction: 'heart', combatRole: 'flanker' },
      { id: 'mama-roamer', name: 'Queen Mama Chanter', kind: 'queen-mama-chanter', position: v(-240, -265), heading: 0.8, ai: 'aggressive', faction: 'big-mom', combatRole: 'rammer' },
      { id: 'baratie-route', name: 'Baratie', kind: 'baratie', position: v(360, -40), heading: -1.1, ai: 'tactical', faction: 'merchant', combatRole: 'flee' },
      { id: 'oro-roamer', name: 'Oro Jackson', kind: 'oro-jackson', position: v(-390, -60), heading: -0.65, ai: 'tactical', faction: 'roger', combatRole: 'ranged' },
      { id: 'marine-patrol', name: 'Marine Patrol Galleon', kind: 'navy-galleon', position: v(60, -120), heading: 0.05, ai: 'tactical', faction: 'marine', combatRole: 'ranged' },
    ],
    islands: [{ id: 'dawn-arch', position: v(-240, -520), radius: 94, height: 76, palette: 2, landmark: 'arches' }], bounty: 30_000_000,
  },
  'storm-sailing': {
    scene: 'storm-sailing', mode: 'explore', weather: 'storm', objective: 'Hold course through the Grand Line squall',
    windDirection: 2.25, windStrength: 1.55, currentDirection: 1.2, currentStrength: 0.68,
    player: { id: 'player', kind: 'thousand-sunny', position: v(0, 0), heading: -0.62 }, rivals: [],
    islands: [{ id: 'storm-needles', position: v(310, -440), radius: 125, height: 125, palette: 4, landmark: 'needles' }], bounty: 30_000_000,
  },
  'sunny-broadside': {
    scene: 'sunny-broadside', mode: 'combat', weather: 'swell', objective: 'Cross their stern and fire the port broadside',
    windDirection: -0.4, windStrength: 0.95, currentDirection: 0.25, currentStrength: 0.28,
    player: { id: 'player', kind: 'thousand-sunny', position: v(0, 0), heading: Math.PI / 2 },
    rivals: [
      { id: 'marine-alpha', kind: 'navy-galleon', position: v(-64, -18), heading: Math.PI / 2, ai: 'tactical', faction: 'marine', combatRole: 'broadside', damage: 0.28 },
      { id: 'marine-beta', kind: 'navy-galleon', position: v(-116, 55), heading: 0.35, ai: 'aggressive', faction: 'marine', combatRole: 'rammer' },
      { id: 'marine-gamma', kind: 'navy-galleon', position: v(-145, -94), heading: 2.4, ai: 'reckless', faction: 'marine', combatRole: 'flanker' },
    ], islands: [], bounty: 94_000_000,
  },
  'moby-scale': {
    scene: 'moby-scale', mode: 'discovery', weather: 'calm', objective: 'Sail alongside the legendary Moby Dick',
    windDirection: 0.2, windStrength: 0.65, currentDirection: 0.25, currentStrength: 0.16,
    player: { id: 'player', kind: 'going-merry', position: v(46, 62), heading: 0 },
    rivals: [{ id: 'moby', kind: 'moby-dick', position: v(-40, -20), heading: 0, ai: 'tactical', faction: 'whitebeard', combatRole: 'escort' }], islands: [], bounty: 30_000_000,
  },
  'fleet-battle': {
    scene: 'fleet-battle', mode: 'combat', weather: 'swell', objective: 'Break the Marine formation',
    windDirection: 1.1, windStrength: 1.1, currentDirection: -0.35, currentStrength: 0.35,
    player: { id: 'player', kind: 'red-force', position: v(0, 80), heading: 0 },
    rivals: [
      { id: 'marine-vanguard', kind: 'navy-galleon', position: v(-85, -80), heading: 0.15, ai: 'aggressive', faction: 'marine', combatRole: 'rammer' },
      { id: 'marine-line', kind: 'navy-galleon', position: v(0, -130), heading: -0.1, ai: 'tactical', faction: 'marine', combatRole: 'broadside' },
      { id: 'marine-flanker', kind: 'polar-tang', position: v(105, -65), heading: -0.4, ai: 'reckless', faction: 'marine', combatRole: 'flanker' },
    ], islands: [{ id: 'battle-reef', position: v(-235, 60), radius: 72, height: 24, palette: 1, landmark: 'needles' }], bounty: 404_800_000,
  },
  'damaged-ship': {
    scene: 'damaged-ship', mode: 'combat', weather: 'fog', objective: 'Allocate crew to repairs before the hunter returns',
    windDirection: -1.6, windStrength: 0.52, currentDirection: -0.9, currentStrength: 0.2,
    player: { id: 'player', kind: 'going-merry', position: v(0, 0), heading: 0, damage: 0.9 },
    rivals: [{ id: 'hunter', kind: 'navy-galleon', position: v(-135, -210), heading: 0.1, ai: 'tactical', faction: 'marine', combatRole: 'ranged', damage: 0.36 }], islands: [], bounty: 66_000_000,
  },
  'island-discovery': {
    scene: 'island-discovery', mode: 'discovery', weather: 'fog', objective: 'Approach the nameless volcano and record it on the chart',
    windDirection: 0.75, windStrength: 0.68, currentDirection: 0.3, currentStrength: 0.18,
    player: { id: 'player', kind: 'thousand-sunny', position: v(40, 170), heading: 0.11 }, rivals: [],
    islands: [
      { id: 'ember-crown', position: v(0, -190), radius: 132, height: 146, palette: 3, landmark: 'volcano' },
      { id: 'palm-key', position: v(245, -65), radius: 58, height: 30, palette: 1, landmark: 'palms' },
    ], bounty: 30_000_000,
  },
  'race-start': {
    scene: 'race-start', mode: 'race', weather: 'calm', objective: 'Win the three-lap Pirate Cup',
    windDirection: -0.5, windStrength: 0.85, currentDirection: 0.2, currentStrength: 0.3,
    player: { id: 'player', kind: 'thousand-sunny', position: v(-90, 78), heading: 0 }, rivals: raceRivals(), islands: [],
    raceCourse: CIRCUIT, raceCountdown: 3.9, bounty: 30_000_000,
  },
  'race-rough': {
    scene: 'race-rough', mode: 'race', weather: 'storm', objective: 'Take the reef shortcut across the swell',
    windDirection: 1.45, windStrength: 1.35, currentDirection: -0.8, currentStrength: 0.66,
    player: { id: 'player', kind: 'polar-tang', position: v(-90, 78), heading: 0 }, rivals: raceRivals(),
    islands: [
      { id: 'left-stack', position: v(-210, -15), radius: 42, height: 92, palette: 4, landmark: 'needles' },
      { id: 'right-stack', position: v(75, -45), radius: 35, height: 74, palette: 4, landmark: 'needles' },
    ], raceCourse: ROUGH_CIRCUIT, raceCountdown: 0, bounty: 30_000_000,
  },
  'crew-closeup': {
    scene: 'crew-closeup', mode: 'explore', weather: 'calm', objective: 'Crew at stations — make sail!',
    windDirection: 0.35, windStrength: 0.58, currentDirection: 0.15, currentStrength: 0.12,
    player: { id: 'player', kind: 'thousand-sunny', position: v(0, 0), heading: 0 }, rivals: [], islands: [], bounty: 30_000_000,
  },
  'night-encounter': {
    scene: 'night-encounter', mode: 'combat', weather: 'night', objective: 'Identify the lanterns closing through the dark',
    windDirection: -2, windStrength: 0.9, currentDirection: 1.45, currentStrength: 0.34,
    player: { id: 'player', kind: 'oro-jackson', position: v(0, 35), heading: 0 },
    rivals: [
      { id: 'night-mama', kind: 'queen-mama-chanter', position: v(-112, -145), heading: 0.15, ai: 'aggressive' },
      { id: 'night-escort', kind: 'navy-galleon', position: v(90, -180), heading: -0.3, ai: 'tactical' },
      { id: 'night-raider', kind: 'red-force', position: v(-205, -35), heading: 1.1, ai: 'reckless' },
    ], islands: [], bounty: 556_400_000, timeOfDay: 0.92,
  },
  'perf-fleet': {
    scene: 'perf-fleet', mode: 'combat', weather: 'swell', objective: 'Survive the Buster Call formation',
    windDirection: 0.9, windStrength: 1.08, currentDirection: -0.5, currentStrength: 0.4,
    player: { id: 'player', kind: 'moby-dick', position: v(0, 90), heading: 0 },
    rivals: [
      { id: 'perf-1', kind: 'navy-galleon', position: v(-180, -150), heading: 0, ai: 'tactical' },
      { id: 'perf-2', kind: 'navy-galleon', position: v(-90, -195), heading: 0, ai: 'aggressive' },
      { id: 'perf-3', kind: 'navy-galleon', position: v(0, -220), heading: 0, ai: 'tactical' },
      { id: 'perf-4', kind: 'navy-galleon', position: v(90, -195), heading: 0, ai: 'reckless' },
      { id: 'perf-5', kind: 'navy-galleon', position: v(180, -150), heading: 0, ai: 'aggressive' },
      { id: 'perf-6', kind: 'polar-tang', position: v(-245, -20), heading: 1.1, ai: 'reckless', faction: 'marine', combatRole: 'flanker' },
      { id: 'perf-7', kind: 'red-force', position: v(245, -20), heading: -1.1, ai: 'aggressive', faction: 'marine', combatRole: 'rammer' },
    ], islands: [], bounty: 1_500_000_000,
  },
};

export function getScenarioPreset(scene: DebugScene): ScenarioPreset {
  return SCENARIO_PRESETS[scene];
}
