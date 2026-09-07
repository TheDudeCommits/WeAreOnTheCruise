# Release record

Current branch: `codex/cinematic-anime-overhaul`, base `codex/vertical-slice` at `ba33a1760fddebb084764a612e4ee52589337c3d`. Draft [PR #1](https://github.com/TheDudeCommits/WeAreOnTheCruise/pull/1).

Verified [downloaded-fleet Preview](https://we-are-on-the-cruise-f2af4qn0n-amirs-projects-d9680079.vercel.app): **READY**, deployment `dpl_2EbBeyjdVAQinFYyqLEE8Uhpqgxe`, implementation commit `a851c37f98b1091aa3cee3f90d66034ac89753c1`, target Preview (`null` in Vercel metadata). Verified 2026-09-07 at approximately 15:01 UTC through deployment metadata and successful build logs. Vercel emitted `index-JOAubjRr.js` and `index-mwMK32qf.css`, matching the local immutable build 23 filenames. The deployed page was not fetched or browser-tested; gameplay and performance evidence refer to the local immutable build. [Verification receipt](evidence/release-preview-23.json).

This contains six actual downloaded ships/four downloaded character models and removes generated replacement ships. Local validation: 163 maintained tests, TypeScript/Vite build, six source captures, eight asset loading/race checks, 27 UI checks and 191 special behavior checks. Four final real-RAF cases average 59.994–60.000 FPS on Apple M4 with zero sampled frames over 25 ms; exact DPR and scope are in the implementation review. The final blind visual critic rejects target-A parity at 5/10.

The subsequent release-record commit changes documentation only. This record deliberately links the immutable implementation Preview, not an unverified documentation deployment. All owned browser sessions and local QA servers were closed after use.

The earlier [build 15 Preview](https://we-are-on-the-cruise-dgbgx79w5-amirs-projects-d9680079.vercel.app), `dpl_9ZDSPvGkULeuvan5iJEApzeCdgjB`, commit `96416050240934ec52df66009fb8be9a748efabf`, contains the rejected generated ships. It is historical and must not be offered as the corrected asset build. The subsequent documentation-only commit `688cc865fceeb4678ddb5472efeae199a7192439` also deployed as Preview and contains the same older runtime.

Production remains https://we-are-on-the-cruise.vercel.app at baseline commit `ba33a1760fddebb084764a612e4ee52589337c3d`, deployment `dpl_4fb3pkBU9F8VTkBDgF8crGNk2HPg`, re-resolved through Vercel metadata after the corrected Preview became READY. No Production promotion has been requested/performed for this correction. No deployed page fetch/browser acceptance is claimed.

See [implementation review](IMPLEMENTATION-REVIEW.md), [current asset gallery](assets-gallery/index.html) and [asset provenance](../../ASSET-LICENSES.md). The official remaining download queue is rate-limited; full target-A visual acceptance is still open.
