# Independent read-only code review — build 14

Verdict: **PASS within the reviewed code/runtime scope. No concrete new regression found.** The build-13 mechanics verdict remains intact. No runtime/source files were edited and no browser was used.

Reviewed the four-row pressure wall and pooled foam/particles in `NavalFxView`, Sunny special camera framing and its input overrides, Polar assisted-camera height compensation, FX precompilation during startup, adaptive DPR resizing, and Polar crew placement/visibility.

## Verified behavior

- **Targeted suite:** 42 tests across `specials.test.ts`, `ship-presentation.test.ts`, and `aim-readability.test.ts` pass. This includes the capsule raycast contact check, Polar crew hiding during active/recovery and reappearing after phase clear, pressure-front surface conformity, and the previously fixed simulation/save/muzzle cases.
- **Sunny camera:** independent fake-canvas input checks confirm special assistance changes the framing. Active aiming, manual orbit, and disabled assistance each produce the same camera position/orientation as their corresponding ordinary-sailing case. Camera updates do not mutate ship state.
- **Polar camera:** assisted chase and cinematic views remain above the sampled sea for a 17 m submerged hull. This verifies the assisted presets; it does not claim that manually selected deck/bow views are constrained above water.
- **Pressure geometry:** 20 simultaneous four-row Moby fronts produce the expected 34,560 indices. All indices stay within their vertex buffer, all written coordinates are finite, and the outer row remains exactly at the authoritative radius within float-buffer tolerance. Buffers and scene child counts stay stable over 100 syncs. Phase completion hides the front and clears its draw range; disposal detaches the FX root.
- **Pooled effects:** active instance counts stay within their fixed matrix capacities. FX sync does not mutate the simulation snapshot.
- **Adaptive DPR:** an independent host-method test changes ratio 1.5 → 1.35 with one `setPixelRatio` call and no extra `resize` call. The installed Three.js implementation itself calls `setSize` from `setPixelRatio`, supporting the removal of the duplicate resize.
- **Hidden FX precompilation:** inspected the installed Three.js `WebGLRenderer.compile`/`compileAsync` implementation. Material preparation uses `scene.traverse`, so hidden FX meshes are included; visibility is not changed. The startup invocation supplies the main target scene and awaits readiness before installing the ready debug bridge.
- Targeted `git diff --check` passes.

## Evidence

- `output/overhaul-gauntlet/critic-specials-code-14-repro.ts`
- `output/overhaul-gauntlet/critic-specials-code-14-evidence.json`

Commands completed successfully:

```sh
npm test -- --run tests/specials.test.ts tests/ship-presentation.test.ts tests/aim-readability.test.ts
node --input-type=module -e 'import {createServer} from "vite"; const server=await createServer({server:{middlewareMode:true},appType:"custom"}); try { await server.ssrLoadModule("/output/overhaul-gauntlet/critic-specials-code-14-repro.ts"); } finally { await server.close(); }' > output/overhaul-gauntlet/critic-specials-code-14-evidence.json
```

The independent runner uses Three.js objects without a browser or WebGL context and closes its SSR server in `finally`. Therefore this verdict does not establish actual GPU shader compilation, rendered appearance, frame-time performance, or production acceptance. Those remain covered by the root agent's final browser capture/performance checks. The in-progress interface CSS/pause-label work was outside this review.
