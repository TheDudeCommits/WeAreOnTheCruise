# We Are On The Cruise

A browser naval survivor-like (Vite + TypeScript + Three.js r185, desktop Chrome). Captain one ship through
15-minute runs on the Brightwater: guns fire on their own when enemies bear, you steer, brace, boost and aim
three skills, sink wave after wave of Admiralty and Redtide ships, level up through weapon cards, and grow your
ship until the bosses arrive at 5, 10 and 15 minutes. Doubloons bank between runs for harbor upgrades, new
ships and new seas.

This is an unofficial, non-commercial fan project. The world, factions and names are original; the six hero
ship models are community downloads kept for now (credited in [ASSET-LICENSES.md](./ASSET-LICENSES.md)).

- Design bible: [docs/overhaul-v2/DESIGN.md](./docs/overhaul-v2/DESIGN.md)
- Art targets and audit: [docs/aaa-overhaul/AAA-OVERHAUL-PLAN.md](./docs/aaa-overhaul/AAA-OVERHAUL-PLAN.md)
- Continuation notes: [HANDOVER.md](./HANDOVER.md)

## Run

```bash
npm ci
npm run dev      # http://localhost:4173
npm run check    # typecheck + tests
npm run build
```

QA URL flags: `?run=<ship>[:<sea>]` jumps into a run, `?god=1`, `?hud=0` (clean plates), `?capture=1`,
`?quality=low|medium|high|ultra`, `?seed=...`. `window.__CRUISE__` exposes a debug bridge (summary, advance,
spawn, boss, level, weapon...). Module labs live at `/lab/<name>.html`.

## Controls

W/S sail gears · A/D rudder · Shift boost · Space brace (parry if timed) · mouse aim · LMB/Q full broadside ·
E special · R ultimate · RMB drag orbit · wheel zoom · 1–4 pick a card · X reroll · Esc pause.
