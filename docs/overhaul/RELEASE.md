# Release record

Branch: `codex/cinematic-anime-overhaul`.
Base: `codex/vertical-slice` at `ba33a1760fddebb084764a612e4ee52589337c3d`.

Implementation commit: `96416050240934ec52df66009fb8be9a748efabf`, pushed to the branch above.

Draft review: [PR #1](https://github.com/TheDudeCommits/WeAreOnTheCruise/pull/1), targeting `codex/vertical-slice`.

Verified immutable [Preview](https://we-are-on-the-cruise-dgbgx79w5-amirs-projects-d9680079.vercel.app): `dpl_9ZDSPvGkULeuvan5iJEApzeCdgjB`, READY, target Preview (`null` in Vercel's API), exact implementation commit above. Verified on 2026-09-07 at 12:30 UTC through deployment metadata and build logs. Vercel completed TypeScript/Vite and emitted the same JS/CSS filenames as locally validated build 15: `index-CPH4y5aV.js` and `index-B70r0Hc4.css`. The deployed page was not fetched or browser-tested; gameplay and performance evidence refer to the local immutable build.

The later release-record commit changes documentation only. This record deliberately links the immutable implementation Preview rather than claiming a documentation commit has already deployed. [Verification receipt](evidence/release-preview-15.json).

Local validation: 168 maintained tests, 27 UI checks, 92 aiming checks, 165 special checks, 10 full-voyage checks and 52 gallery checks pass. Six special profiles and ten sustained profiles averaged approximately 60 FPS on the Apple M4 host; phone viewports are desktop-GPU emulation. See [implementation review](IMPLEMENTATION-REVIEW.md) for exact dimensions, receipts and acceptance limits.

Visual concept parity remains unaccepted, and zero Sketchfab models have been downloaded. The draft PR preserves those open requirements. All automated browser sessions and candidate QA servers were closed after use.

Existing Production: https://we-are-on-the-cruise.vercel.app
Verified baseline Vercel deployment: `dpl_4fb3pkBU9F8VTkBDgF8crGNk2HPg`, READY, target Production.
The Production alias was re-resolved through Vercel after the Preview became READY and still points to the baseline commit `ba33a1760fddebb084764a612e4ee52589337c3d`. No Production promotion was performed.
