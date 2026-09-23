# Full voyage probe — ordinary simulation commands

2026-09-06, local working tree on `codex/cinematic-anime-overhaul`.

**Five of six fixed combinations completed all three sheltered legs, defeated the final captain, banked the full contract payout and restored their final saves.** The sixth failed its escort objective. These are simulation results, not browser interaction, performance, visual-quality or comprehensive balance acceptance.

| Seed | Ship / build | Contract | Three legs | Result / bank |
| --- | --- | --- | --- | --- |
| `full-voyage-01` | Moby Dick / guardian | Lost Cargo | salvage 56.4s → storm 64.6s → boss 299.0s | completed / 1,175 |
| `full-voyage-02` | Oro Jackson / guardian | Lost Cargo | salvage 43.8s → storm 46.0s → boss 43.5s | completed / 1,210 |
| `full-voyage-03` | Marine Galleon / guardian | Tempest Chart | storm 52.8s → storm 52.8s → boss 35.2s | completed / 1,315 |
| `full-voyage-04` | Moby Dick / guardian | Tempest Chart | storm 64.6s → storm 64.6s → boss 149.6s | completed / 1,350 |
| `full-voyage-05` | Queen Mama Chanter / guardian | Lost Cargo | salvage 53.2s → escort lost 26.2s | failed / 0 |
| `full-voyage-06` | Oro Jackson / precision | Tempest Chart | storm 44.4s → storm 44.4s → boss 57.6s | completed / 1,350 |

Times in the table are simulated elapsed time, not wall-clock benchmark results. One Vitest case covered all six combinations in 778ms; total runner time was 1.04s. No browser opened.

## Reproduction and policy

```sh
npx vitest run --config output/overhaul-gauntlet/full-voyage-probe.config.ts
```

All six seeds and combinations were declared before running. Each run starts at the public harbor, selects its vessel/build/contract, and chooses each offered measured route. The bot reads visible ship position, heading, speed, health, reload, target and objective state; only public player commands change the game. It steers with positive angular error mapped to left and negative to right, navigates storm gates, brakes inside salvage radius, pursues targets into broadside range, and uses the normal ±0.28-radian aim clamp with velocity lead. Repair crew stays assigned; explicit repair commands fill reload time, fire is released from repair before a shot, and available specials trigger within 110m. Every leg uses an explicit collect action and Fresh Supplies. A disabled target is salvaged only when the existing public range/credit check permits it. The bot has a 600 simulated-second limit per leg and a 160-second wall deadline across all six.

No state assignments, damage fixtures, teleportation, projectile injection, forced completion or reward injection occur. Public save export/JSON restore runs after route selection, every 30 simulated seconds, after rewards and at successful termination; held controls are released before restore. Each successful run checks all three objectives, `result.outcome === completed`, one completed voyage, a single paid voyage ID, equality between payout and bank, and rejection of duplicate collect/extract/reward commands without changing the bank. The five final JSON saves are retained next to the probe.

## Limits and next checks

- The Queen Mama escort defeat is retained unchanged. Its own hull damage was only 1.8%, so the loss concerns escort survival rather than captain death. This simple policy did not protect the merchant; it does not prove that route is unwinnable.
- Outcomes span roughly 35–299 seconds for the final captain. Guardian plus repair crew often restores the captain to full hull; that spread merits future balance and human-play testing.
- All successful second legs in this fixed sample were storm routes. Successful escort completion and dangerous full-voyage completion are not established here.
- Browser launch, chart/reward controls, storage and rendered terminal receipts require a separate browser run. The probe alone does not validate them.

## Artifacts and tested source identity

- `full-voyage-probe.test.ts`, `.config.ts`: exact policy and assertions.
- `full-voyage-probe.results.json`, `.run.log`: all attempts, action transition counts, event counts, per-leg results and restore counts.
- `full-voyage-probe.full-voyage-01.save.json`, `-02`, `-03`, `-04`, `-06`: completed final saves.
- SHA-256 `src/simulation/GameSimulation.ts`: `a897d34d5d6727f38a28bc01dbfda95fa1ac800d8f2d97df96d0f38500852990`.
- SHA-256 `src/simulation/saveValidation.ts`: `a72ddbe30d948060ebc035fa0bc3054b1d06c5950034f8a07c0663d963c1b943`.
- SHA-256 probe: `2b23dae4951570ebe57790184f1b686d407479d94dbe835daf8a9adfc7ad0976`.

No runtime or maintained test files changed for this QA task.
