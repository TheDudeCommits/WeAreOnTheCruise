# Round 1 — what shipped

**Owner asks (2026-09-24):**
- faster battles;
- more enemy variety;
- more big-world events;
- speed upgrades;
- AI bots as other players while no live players are online;
- a level-up screen that doesn't darken the game;
- then keep iterating (the gauntlet loop);
- finally a new Vercel production at cruise.dude.work.

## Streams, merged into `claude/naval-survivor-overhaul`

| Stream | Branch | Result |
|---|---|---|
| PACE | r1/pace | See [PACE](#pace) below. |
| FOES | r1/foes | See [FOES](#foes) below. |
| EVENTS | r1/events | See [EVENTS](#events) below. |
| CAPTAINS | r1/captains | See [CAPTAINS](#captains) below. |
| CRITIC | r1/critic | Gauntlet tooling (evidence, session probe, worktrees) and six domain critiques. |

### PACE
- Ships: about +17% speed, +35% acceleration and +12% turn.
- Enemies +12%, shots +15%, weapon cooldowns ×0.85.
- A floor-driven horde: 76 ships from about 12:00.
- A cheap-then-steep XP curve, and a 140 m magnet.
- Seven speed upgrades: Clipper Rigging, Racing Keel, Momentum and Trade Winds as passives; Copper Sheathing, Storm Sails and Rudder Chains in the harbor.
- 16 new icons, costing 2 Higgsfield credits.

### FOES
- Seven new classes:
  - signal cutter (marks the target);
  - ironclad (armoured bow, charges);
  - harpooner (tether);
  - bomb ketch (keg clusters);
  - smoke runner (smoke screens);
  - lantern wisp (latch and drain);
  - drowned galleon (rises from below).
- Eight elite affixes.
- Named bounty captains.
- The tint fix: hit flashes and elite gold now show on every class.

### EVENTS
- Eight set pieces:
  - Kraken Rising;
  - Rogue Wave;
  - Maelstrom;
  - Admiralty Blockade;
  - Ghost Fleet;
  - Volcanic Eruption;
  - Sunken Treasure;
  - Bounty Contract.
- The tracker HUD.
- Points of interest: trade-wind lanes, lighthouse beacons and salvage.
- Events every 35–60 s.

### CAPTAINS
- AI captains, 0–4 (default 3). They join, fight near the player, split the fleet's aggro, sink and respawn.
- Roster, kill feed, callouts and nameplates.
- A settings selector.
- A presence abstraction (AI now, online later).

## Lead integration
- A contract commit (f27839f) laid down ids, captain/event/affix state, `focusOf` targeting and module stubs.
- The level-up screen has no shade at all.
- Critic S1 fixes:
  - results buttons always on screen;
  - boss framing;
  - no daytime foam carpet;
  - no XP from the final boss, so no card screens over the victory lap.
- Night bioluminescence limited to fresh foam; dive/phase foam sized by the hull.
- Smoke hides ships from auto-aim only (`acquirable`).
- Captains:
  - they take FOES and EVENTS damage through `hurtCaptain`;
  - their sinkings don't feed the player's Momentum.
- Contact shove capped, and island crashes capped at 8% of the hull.
- Galleons raised by the Ghost Fleet skip FOES' dive cycle.
- Kraken arms skip ship FX.
- Audio: cues for the new events, lighter captain gunfire, and outcome banners muted under their sting.

## Balance before the round-1 tune (3 seeds × 2 ships, 18 min, 3 captains)
- Sunward: 0/6 deaths, 6 wins, bosses about 40 s, about 1,240 doubloons per run.
- Stormwrack: 2/6 deaths.
- Gloam: 1/6 deaths.
- Captains sank 8–10 times a run.

The lead's tune (63e0055) changed:
- boss HP 2.1 / 2.4 / 1.8;
- sturdier captains that bring 42% more fleet fire each;
- doubloon income halved.

REPLAY owns the real economy and balance pass in round 2.
