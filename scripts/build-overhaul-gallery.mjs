#!/usr/bin/env node
/** Build a portable offline review. Copies only selected PNGs and small evidence files, never game assets. */
import { mkdir, readFile, writeFile, copyFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, basename, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(
  repo,
  process.env.CRUISE_REVIEW_OUTPUT_DIR ?? "docs/overhaul/gallery",
);
const captures = resolve(
  repo,
  process.env.CRUISE_REVIEW_CAPTURE_DIR ?? "output/overhaul-gauntlet/pass-15",
);
const ui = resolve(
  repo,
  process.env.CRUISE_REVIEW_UI_DIR ?? "output/overhaul-gauntlet/ui-15",
);
const aim = resolve(
  repo,
  process.env.CRUISE_REVIEW_AIM_DIR ?? "output/overhaul-gauntlet/aim-15",
);
const progression = resolve(
  repo,
  process.env.CRUISE_REVIEW_PROGRESSION_DIR ??
    "output/overhaul-gauntlet/progression-15",
);
const concepts = resolve(repo, "docs/art-direction/concepts");
const specials = resolve(repo, process.env.CRUISE_REVIEW_SPECIALS_DIR ?? "output/overhaul-gauntlet/specials-15");
const specialPerformance = resolve(repo, process.env.CRUISE_REVIEW_SPECIAL_PERFORMANCE_DIR ?? "output/overhaul-gauntlet/special-performance-15");
const performance = resolve(
  repo,
  process.env.CRUISE_REVIEW_PERFORMANCE_DIR ??
    "output/overhaul-gauntlet/performance-15",
);
const optionalJson = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
};
const validation = process.env.CRUISE_REVIEW_VALIDATION_FILE
  ? JSON.parse(
      await readFile(
        resolve(repo, process.env.CRUISE_REVIEW_VALIDATION_FILE),
        "utf8",
      ),
    )
  : undefined;
const suppliedCount =
  process.env.CRUISE_REVIEW_TEST_COUNT ??
  validation?.numPassedTests ??
  validation?.testsPassed ??
  validation?.testCount;
const testCount =
  suppliedCount === undefined ? undefined : Number(suppliedCount);
if (testCount !== undefined && (!Number.isInteger(testCount) || testCount < 0))
  throw new Error(
    "CRUISE_REVIEW_TEST_COUNT must be a nonnegative integer from the final validation run.",
  );
const aimReceipt = await optionalJson(resolve(aim, "receipt.json"));
const aimChecks = aimReceipt?.runs?.flatMap((run) => run.checks ?? []) ?? [];
const aimPassed = aimChecks.filter((check) => check.pass === true).length;
const aimTotal = aimChecks.length;
const aimCountLabel = aimTotal
  ? `${aimPassed} <small>/ ${aimTotal}</small>`
  : "Pending";
const aimViewports = new Set(aimReceipt?.runs?.map((run) => run.name) ?? []);
const aimCoverage =
  aimViewports.has("portrait") && aimViewports.has("landscape")
    ? "Desktop and both phone orientations through touch emulation, including simultaneous aim/fire and pause recovery."
    : aimViewports.has("landscape")
      ? "Desktop and landscape touch emulation, including simultaneous aim/fire and pause recovery."
      : "See the attached receipts for tested viewports and input coverage.";
const aimProof = aimTotal
  ? `Recorded aim validation passed ${aimPassed} of ${aimTotal} desktop/touch checks, covering side selection, pointer lead, projectile bearing, reload and pause recovery.`
  : "Final aim receipts have not been attached to this review.";
const progressionReceipt = await optionalJson(
  resolve(progression, "receipt.json"),
);
const extractionCount =
  progressionReceipt?.runs?.filter(
    (run) => run.complete && run.payout?.result?.outcome === "extracted",
  ).length ?? 0;
const extractionProof = extractionCount
  ? `${extractionCount} earned early-extraction runs, reward choices, a refit purchase and reload persistence are recorded.`
  : "Final earned-extraction and refit receipts have not been attached to this review.";

const slash = (value) => value.replaceAll("\\", "/");
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
const nodeVoyageFile = resolve(
  repo,
  process.env.CRUISE_REVIEW_NODE_VOYAGE_FILE ??
    "output/overhaul-gauntlet/full-voyage-probe.results.json",
);
const nodeVoyageReport = resolve(
  repo,
  process.env.CRUISE_REVIEW_NODE_VOYAGE_REPORT ??
    "output/overhaul-gauntlet/full-voyage-probe.report.md",
);
const nodeVoyageReceipt = await optionalJson(nodeVoyageFile);
const nodeVoyageRuns = nodeVoyageReceipt?.results ?? [];
const nodeVoyageWins = nodeVoyageRuns.filter(
  (run) =>
    run.won === true &&
    run.terminal === "complete" &&
    run.result?.outcome === "completed" &&
    run.legs?.length === 3 &&
    run.legs.every((leg) => leg.completed === true),
).length;
const nodeEscortLosses = nodeVoyageRuns.filter(
  (run) =>
    run.won === false &&
    run.terminal === "failed" &&
    run.legs?.at(-1)?.kind === "escort",
).length;
const nodeVoyageProof = nodeVoyageRuns.length
  ? `${nodeVoyageWins} of ${nodeVoyageRuns.length} scripted legal-input simulation runs completed three legs${nodeEscortLosses ? `; ${nodeEscortLosses} escort ${nodeEscortLosses === 1 ? "loss" : "losses"}` : ""}. This is not human play or balance proof.`
  : "Scripted three-leg completion evidence has not been attached to this review.";
const fullVoyageFile = resolve(
  repo,
  process.env.CRUISE_REVIEW_FULL_VOYAGE_FILE ??
    "output/overhaul-gauntlet/full-voyage-15/receipt.json",
);
const fullVoyageReceipt = await optionalJson(fullVoyageFile);
const fullVoyageAttached = Boolean(fullVoyageReceipt);
function verifiedFullVoyage(receipt) {
  const checks = receipt?.checks;
  const final = receipt?.final;
  const restored = receipt?.restored;
  const voyage = final?.voyage;
  const progression = final?.progression;
  const requiredChecks = [
    ...[1, 2, 3].map((leg) => `Leg ${leg} completed through legal commands`),
    "Full contract is completed, not extracted",
    "Exact third-leg payout plus contract bonus",
    "Paid ledger has one entry for this voyage",
    "Browser storage contains final payout and ledger",
    "Reload restores exact completed voyage and payout ledger",
    "No browser console or page errors",
  ];
  return Boolean(
    Array.isArray(checks) && checks.length >= requiredChecks.length &&
    checks.every((check) => check.pass === true) &&
    requiredChecks.every((name) => checks.some((check) => check.name === name)) &&
    Array.isArray(receipt.errors) && receipt.errors.length === 0 &&
    Array.isArray(receipt.legs) && receipt.legs.length === 3 &&
    receipt.legs.every((leg) => leg.completed === true && leg.encounter?.completed === true) &&
    voyage?.phase === "complete" && voyage.result?.outcome === "completed" &&
    voyage.leg === 3 && voyage.totalLegs === 3 &&
    Number.isInteger(voyage.result.coins) && voyage.result.coins > 0 &&
    progression?.completedVoyages >= 1 &&
    Number.isInteger(progression.bankedCoins) && progression.bankedCoins >= voyage.result.coins &&
    Array.isArray(progression.paidVoyageIds) &&
    progression.paidVoyageIds.filter((id) => id === voyage.id).length === 1 &&
    JSON.stringify(restored?.voyage) === JSON.stringify(voyage) &&
    JSON.stringify(restored?.progression) === JSON.stringify(progression),
  );
}
const fullVoyageVerified = verifiedFullVoyage(fullVoyageReceipt);
const fullVoyageProof = fullVoyageVerified
  ? `A browser voyage completed three earned legs, banked ${fullVoyageReceipt.final.voyage.result.coins.toLocaleString("en-US")} coins once, and restored the exact completed voyage and payout ledger. All ${fullVoyageReceipt.checks.length} assertions passed. This used accelerated legal inputs, not human play or an FPS measurement.`
  : fullVoyageAttached
    ? "A browser full-voyage receipt is attached, but it does not satisfy all completion, earned-payout and reload checks. No verified browser victory is claimed."
    : "Browser full-voyage completion proof has not been attached.";
const fullVoyageImage = fullVoyageVerified &&
  fullVoyageReceipt.screenshots?.includes("04-contract-completed.png") &&
  (await exists(resolve(dirname(fullVoyageFile), "04-contract-completed.png")))
    ? resolve(dirname(fullVoyageFile), "04-contract-completed.png")
    : undefined;
const performanceSummary = await optionalJson(
  resolve(performance, "summary.json"),
);
const performanceRecords = performanceSummary?.records ?? [];
const validPerformance = performanceRecords.filter(
  (record) =>
    record.validMeasurement === true &&
    Number.isFinite(record.frameTimes?.averageFps),
);
const tidyNumber = (value) => String(Number(value.toFixed(1)));
const tidyFps = (value) => String(Number(value.toFixed(3)));
const fpsMin = validPerformance.length
  ? Math.min(...validPerformance.map((record) => record.frameTimes.averageFps))
  : undefined;
const fpsMax = validPerformance.length
  ? Math.max(...validPerformance.map((record) => record.frameTimes.averageFps))
  : undefined;
const recordedMaxFrames = validPerformance
  .map((record) => record.frameTimes.maxFrameMs)
  .filter(Number.isFinite);
const maxFrameMs = recordedMaxFrames.length
  ? Math.max(...recordedMaxFrames)
  : undefined;
const recordedOver50Counts = validPerformance
  .map((record) => record.frameTimes.overBudget?.["50ms"]?.count)
  .filter((count) => Number.isInteger(count) && count >= 0);
const over50Frames = recordedOver50Counts.length
  ? recordedOver50Counts.reduce((sum, count) => sum + count, 0)
  : undefined;
const performanceLabel =
  fpsMin === undefined
    ? "Pending"
    : `${tidyFps(fpsMin)}${tidyFps(fpsMin) === tidyFps(fpsMax) ? "" : `–${tidyFps(fpsMax)}`} <small>fps</small>`;
const performanceHardware =
  performanceSummary?.machine?.cpuModels?.join(" / ") ?? "Unreported hardware";
const performanceTitle = validPerformance.length
  ? `Measured on ${performanceHardware}`
  : "Performance evidence pending";
const performanceDetail = [
  maxFrameMs === undefined
    ? "Worst-frame duration was not recorded"
    : `Worst recorded frame ${tidyNumber(maxFrameMs)} ms`,
  over50Frames === undefined
    ? "counts above 50 ms were not recorded"
    : `${over50Frames} ${over50Frames === 1 ? "frame" : "frames"} exceeded 50 ms${recordedOver50Counts.length < validPerformance.length ? " among runs with recorded counts" : ""}`,
].join("; ");
const performanceProof = validPerformance.length
  ? `${validPerformance.length} valid benchmark runs${Number.isFinite(performanceSummary.configuration?.sampleMs) ? `, ${tidyNumber(performanceSummary.configuration.sampleMs / 1000)} seconds each` : ""}. ${performanceDetail}. Other hardware remains unverified.`
  : "The selected performance summary has no valid measured runs. No frame-rate claim is made.";
const specialReceipt = await optionalJson(resolve(specials, "receipt.json"));
const specialKinds = ["thousand-sunny", "polar-tang", "moby-dick"];
const specialRuns = specialReceipt?.runs ?? [];
const specialChecks = specialRuns.flatMap((run) => run.checks ?? []);
const specialPassedChecks = specialChecks.filter((check) => check.pass === true).length;
const verifiedSpecialRun = (run) => Boolean(
  run?.passed === true && specialKinds.includes(run.kind) &&
  Array.isArray(run.checks) && run.checks.length > 0 && run.checks.every((check) => check.pass === true) &&
  Array.isArray(run.errors) && run.errors.length === 0 &&
  Array.isArray(run.dialogs) && run.dialogs.length === 0 &&
  ["windup", "active", "recovery"].every((phase) => run.captures?.some((capture) => capture.filename === `${run.kind}-${phase}.png`)) &&
  run.before?.player?.kind === run.kind && run.before.player.special >= .999 &&
  run.after?.player?.kind === run.kind && !run.after.player.specialPhase && run.after.player.special < .999
);
const specialPassedRuns = specialRuns.filter(verifiedSpecialRun);
const specialsVerified = specialReceipt?.passed === true && specialRuns.length === specialKinds.length &&
  specialKinds.every((kind) => specialPassedRuns.filter((run) => run.kind === kind).length === 1);
const specialFailures = specialRuns.filter((run) => !verifiedSpecialRun(run)).map((run) => run.kind ?? run.name ?? "unnamed run");
const specialProof = specialChecks.length
  ? `${specialPassedRuns.length} of ${specialRuns.length} reference-special runs passed; ${specialPassedChecks} of ${specialChecks.length} checks passed.${specialsVerified ? " Sunny burst, Polar dive/surfacing and Moby wave each completed the recorded wind-up, active and recovery checks." : ` Complete three-ship acceptance is not established${specialFailures.length ? `; unresolved runs: ${specialFailures.join(", ")}` : ""}.`} Trusted UI/key inputs start each sequence; fixed steps stage captures. These are behavior checks, not FPS or cinematic acceptance.`
  : "The selected special capture receipt is pending. Source implementation alone does not establish rendered behavior or visual acceptance.";
const specialPerformanceSummary = await optionalJson(resolve(specialPerformance, "summary.json"));
const specialPerformanceRecords = specialPerformanceSummary?.records ?? [];
const validSpecialPerformance = specialPerformanceRecords.filter((record) =>
  record.valid === true && Number.isFinite(record.frameTimes?.averageFps) &&
  Array.isArray(record.errors) && record.errors.length === 0 &&
  ["windup", "active", "recovery"].every((phase) => record.phases?.[phase]?.samples >= 10 && Number.isFinite(record.phases[phase].averageFps))
);
const specialFpsMin = validSpecialPerformance.length ? Math.min(...validSpecialPerformance.map((record) => record.frameTimes.averageFps)) : undefined;
const specialFpsMax = validSpecialPerformance.length ? Math.max(...validSpecialPerformance.map((record) => record.frameTimes.averageFps)) : undefined;
const specialActiveFpsMin = validSpecialPerformance.length ? Math.min(...validSpecialPerformance.map((record) => record.phases.active.averageFps)) : undefined;
const specialActiveFpsMax = validSpecialPerformance.length ? Math.max(...validSpecialPerformance.map((record) => record.phases.active.averageFps)) : undefined;
const specialMaxFrames = validSpecialPerformance.map((record) => record.frameTimes.maxFrameMs).filter(Number.isFinite);
const specialMaxFrameMs = specialMaxFrames.length ? Math.max(...specialMaxFrames) : undefined;
const specialOver25Counts = validSpecialPerformance.map((record) => record.frameTimes.over25ms).filter((value) => Number.isInteger(value) && value >= 0);
const specialOver25Frames = specialOver25Counts.length === validSpecialPerformance.length && validSpecialPerformance.length
  ? specialOver25Counts.reduce((sum, value) => sum + value, 0) : undefined;
const specialOver50Counts = validSpecialPerformance.map((record) => record.frameTimes.over50ms).filter((value) => Number.isInteger(value) && value >= 0);
const specialOver50Frames = specialOver50Counts.length === validSpecialPerformance.length && validSpecialPerformance.length
  ? specialOver50Counts.reduce((sum, value) => sum + value, 0) : undefined;
const specialHardware = specialPerformanceSummary?.machine?.cpu?.join(" / ") ?? "unreported hardware";
const specialPerformanceProof = validSpecialPerformance.length
  ? `${validSpecialPerformance.length} of ${specialPerformanceRecords.length} recorded special profiles are valid on ${specialHardware}: ${tidyFps(specialFpsMin)}–${tidyFps(specialFpsMax)} average FPS overall, ${tidyFps(specialActiveFpsMin)}–${tidyFps(specialActiveFpsMax)} during active phases. ${specialMaxFrameMs === undefined ? "Worst-frame duration is unreported" : `Worst frame ${tidyNumber(specialMaxFrameMs)} ms`}; ${specialOver25Frames === undefined ? "long-frame counts incomplete" : `${specialOver25Frames} frames over 25 ms`}${specialOver50Frames === undefined ? "" : `, ${specialOver50Frames} over 50 ms`}.${specialOver25Frames > 0 ? " Hitches remain; mean FPS is not smooth-frame acceptance." : ""} Short real-RAF phase samples supplement the sustained benchmark; no stepping or charge injection. Emulated landscape uses the desktop GPU, not physical mobile hardware.`
  : "Special real-RAF performance evidence is pending or has no valid runs. Fixed-step special captures do not establish frame rate.";
const heroImage = (await exists(resolve(captures, "hero-ship.png")))
  ? "hero-ship.png"
  : "sunny-broadside.png";
const sections = [
  {
    id: "01",
    tab: "Embark",
    title: "Embark at dawn",
    theme: "Entry & control",
    target: "01-embark-at-dawn.png",
    actual: resolve(ui, "desktop-embark.png"),
    caption: "Actual desktop entry, all nine vessel choices.",
    proof:
      "Pointer and keyboard launch, pause and focus recovery are implemented. Mobile interaction is browser-emulated.",
    next: "Keep the world dominant while refining typography, loadout flow and first-sailing guidance.",
  },
  {
    id: "02",
    tab: "The vessel",
    title: "The hero ship",
    theme: "Form & construction",
    target: "02-the-hero-ship.png",
    actual: resolve(captures, heroImage),
    caption:
      heroImage === "hero-ship.png"
        ? "Actual full-ship engine view of the authored original hero vessel."
        : "Actual engine broadside framing of the hero vessel.",
    proof:
      "Deep hull forms, raised decks, billowed sails and shared cannon anchors are implemented with distance detail levels.",
    next: "Bespoke modeling, cleaner material transitions and stronger crew silhouettes still separate the engine from the target.",
  },
  {
    id: "03",
    tab: "Sea & sky",
    title: "A living sea",
    theme: "Water & atmosphere",
    target: "03-living-sea.png",
    actual: resolve(captures, "calm-sailing.png"),
    caption:
      "Actual calm-sailing scene with the current ocean, sky and hull contact.",
    proof:
      "Long waves share gameplay sampling. Weather changes lighting, sea and atmosphere; foam and wakes respond to motion.",
    next: "Refine foam scale, cloud shape, surface detail and distant haze under a consistent art direction.",
  },
  {
    id: "04",
    tab: "Broadside",
    title: "Every shot should read",
    theme: "Aiming & combat",
    target: "04-broadside-combat.png",
    actual: resolve(captures, "sunny-broadside.png"),
    caption:
      "Actual engine broadside scene. Separate aim receipts validate real controls and shots.",
    proof: aimProof,
    next: "Improve composition and effect hierarchy so targets, consequences and firing corrections read at a glance.",
  },
  {
    id: "05",
    tab: "Aftermath",
    title: "Damage with consequence",
    theme: "Damage & finishing",
    target: "05-damage-and-defeat.png",
    actual: resolve(captures, "damaged-ship.png"),
    caption:
      "Authored damage-state engine capture; this image is not proof of a completed battle.",
    proof:
      "Visible damage, disabled-vessel resolution and explicit reward collection are tied to authoritative state.",
    next: "Give hull breaches, flooded list, wreckage and sinking greater structural weight and visual variety.",
  },
  {
    id: "06",
    tab: "The crew",
    title: "A crew with a purpose",
    theme: "Allocation & animation",
    target: "06-crew-at-work.png",
    actual: resolve(captures, "crew-repairs.png"),
    caption: "Actual crew repair state in the current engine.",
    proof:
      "A fixed crew pool trades helm, guns, repair and special capacity. Figures move to stations and perform work poses.",
    next: "The original fallback crew remains below the concept. Stronger anatomy, working hand poses and authored animation are needed.",
  },
  {
    id: "07",
    tab: "Specials",
    title: "Three distinct commitments",
    theme: "Burst, dive & pressure wave",
    target: "09-ship-specials.png",
    actual: resolve(specials, "moby-dick-wave-cinematic.png"),
    caption: "Actual Moby pressure front in the cinematic view. Compare with the right-hand concept panel; the matching overhead view, Sunny and Polar appear below.",
    proof: specialProof,
    next: "Refine thrust, bubble trails and wave form against the concept. Generated target parity remains unachieved. Real-RAF special measurements are reported separately below.",
  },
  {
    id: "08",
    tab: "The passage",
    title: "A world worth crossing",
    theme: "Landmarks & navigation",
    target: "07-arch-passage.png",
    actual: resolve(captures, "island-discovery.png"),
    caption: "Actual approach to the current archipelago landmark.",
    proof:
      "Landmarks, collision, discoveries and ordered passage gates connect scenery to gameplay.",
    next: "Improve cliff silhouettes, inhabited scale, coastline variety and route staging around the monumental arch.",
  },
  {
    id: "09",
    tab: "Next voyage",
    title: "A reason to sail again",
    theme: "Voyage & progression",
    target: "08-the-next-voyage.png",
    actual: resolve(progression, "run-1-extracted.png"),
    caption:
      "Actual earned extraction and payout from the recorded progression run.",
    proof: `${extractionProof} ${nodeVoyageProof}`,
    next: `${fullVoyageProof} Longer-session balance and replay value need continued human playtesting.`,
  },
];
const supplements = [
  {
    name: "Moby wave radius",
    file: resolve(specials, "moby-dick-wave-expanded.png"),
    caption: "Actual overhead view of the same paused wave as the cinematic comparison. Camera settling does not advance its phase, radius or simulation time.",
  },
  {
    name: "Sunny burst",
    file: resolve(specials, "thousand-sunny-active.png"),
    caption: "Actual stern thrust during Sunny’s active burst. A generated effect is never composited over this capture.",
  },
  {
    name: "Polar dive",
    file: resolve(specials, "polar-tang-active.png"),
    caption: "Actual submerged phase. Dive, weapon gating and recovery are checked separately from the image.",
  },
  {
    name: "Touch aim & fire",
    file: resolve(aim, "landscape-port-multitouch-reload.png"),
    caption: "Actual simultaneous touch aiming and firing; browser emulation.",
  },
  {
    name: "Portrait entry",
    file: resolve(ui, "portrait-embark.png"),
    caption: "Actual 390 × 844 browser layout; image shown without cropping.",
  },
  {
    name: "Refit purchased",
    file: resolve(progression, "refit-purchased.png"),
    caption: "Actual refit purchase after earned extraction payouts.",
  },
  {
    name: "Storm at sea",
    file: resolve(captures, "storm-sailing.png"),
    caption: "Actual storm scene from the selected visual capture set.",
  },
];
if (fullVoyageImage) supplements.push({
  name: "Three-leg contract completed",
  file: fullVoyageImage,
  caption: "Actual earned full-contract payout. Accelerated legal-input browser run; exact completed state survived reload.",
});

// Fail explicitly if the chosen pass is incomplete; never silently substitute an older screenshot.
for (const section of sections) {
  await access(resolve(concepts, section.target));
  await access(section.actual);
}
for (const item of supplements) await access(item.file);
await mkdir(resolve(output, "media"), { recursive: true });
await mkdir(resolve(output, "evidence"), { recursive: true });
const manifest = {
  generatedAt: new Date().toISOString(),
  captureSet: slash(relative(repo, captures)),
  validation: {
    testCount: testCount ?? null,
    aimPassed,
    aimTotal,
    extractionCount,
    nodeVoyageWins,
    nodeVoyageRuns: nodeVoyageRuns.length,
    nodeEscortLosses,
    fullVoyageAttached,
    fullVoyageVerified,
    specials: {
      verified: specialsVerified,
      passedRuns: specialPassedRuns.length,
      totalRuns: specialRuns.length,
      passedChecks: specialPassedChecks,
      totalChecks: specialChecks.length,
      unresolvedRuns: specialFailures,
    },
    specialPerformance: {
      validRuns: validSpecialPerformance.length,
      totalRuns: specialPerformanceRecords.length,
      fpsMin: specialFpsMin ?? null,
      fpsMax: specialFpsMax ?? null,
      activeFpsMin: specialActiveFpsMin ?? null,
      activeFpsMax: specialActiveFpsMax ?? null,
      maxFrameMs: specialMaxFrameMs ?? null,
      over25Frames: specialOver25Frames ?? null,
      over50Frames: specialOver50Frames ?? null,
      hardware: specialHardware,
    },
    performance: {
      fpsMin: fpsMin ?? null,
      fpsMax: fpsMax ?? null,
      maxFrameMs: maxFrameMs ?? null,
      over50Frames: over50Frames ?? null,
      validRuns: validPerformance.length,
      totalRuns: performanceRecords.length,
      hardware: performanceHardware,
    },
  },
  inputSets: {
    ui: slash(relative(repo, ui)),
    aim: slash(relative(repo, aim)),
    progression: slash(relative(repo, progression)),
    performance: slash(relative(repo, performance)),
    specials: slash(relative(repo, specials)),
    specialPerformance: slash(relative(repo, specialPerformance)),
  },
  status: "Visual parity not achieved",
  assetIntake: {
    catalogEntries: 1676,
    relevantShipCandidates: 28,
    downloadedModels: 0,
    downloadStatus: "Blocked by Sketchfab authentication",
    currentAssets: "Original Blender-authored hulls and procedural crew",
  },
  images: [],
  evidence: [],
};
const imageCache = new Map();
async function media(source, label, kind) {
  if (imageCache.has(source)) return imageCache.get(source);
  const filename = `${String(manifest.images.length + 1).padStart(2, "0")}-${label}${extname(source)}`;
  const buffer = await readFile(source);
  const url = `media/${filename}`;
  await copyFile(source, resolve(output, url));
  manifest.images.push({
    url,
    kind,
    source: slash(relative(repo, source)),
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  });
  imageCache.set(source, url);
  return url;
}
for (const section of sections) {
  section.targetUrl = await media(
    resolve(concepts, section.target),
    `${section.id}-target`,
    "imagegen-concept",
  );
  section.actualUrl = await media(
    section.actual,
    `${section.id}-engine`,
    "engine-capture",
  );
}
for (const item of supplements)
  item.url = await media(
    item.file,
    basename(item.file, extname(item.file)),
    "engine-evidence",
  );
const documentLinks = [];
for (const [label, path, localName] of [
  [
    "Implementation review",
    resolve(repo, "docs/overhaul/IMPLEMENTATION-REVIEW.md"),
    "implementation-review.md",
  ],
  [
    "Section concept brief",
    resolve(repo, "docs/art-direction/SECTION-CONCEPTS.md"),
    "section-concepts.md",
  ],
  ["Aim acceptance report", resolve(aim, "REPORT.md"), "aim-report.md"],
  ["Aim receipts", resolve(aim, "receipt.json"), "aim-receipt.json"],
  [
    "Progression receipts",
    resolve(progression, "receipt.json"),
    "progression-receipt.json",
  ],
  ["UI receipts", resolve(ui, "receipt.json"), "ui-receipt.json"],
  ["Special phase and weapon receipts", resolve(specials, "receipt.json"), "specials-receipt.json"],
  ["Special real-RAF performance", resolve(specialPerformance, "summary.json"), "special-performance-summary.json"],
  ["Original approved scope", resolve(repo, "docs/overhaul/APPROVED-SCOPE.md"), "approved-scope.md"],
  ["Historical special defects, build 12", resolve(repo, "docs/overhaul/critics/critic-specials-code-12.md"), "critic-specials-code-12.md"],
  ["Special source closure, build 13", resolve(repo, "docs/overhaul/critics/critic-specials-code-13-final.md"), "critic-specials-code-13-final.md"],
  ["Rejected special visuals, build 13", resolve(repo, "docs/overhaul/critics/critic-specials-visual-13.md"), "critic-specials-visual-13.md"],
  ["Special source review, build 14", resolve(repo, "docs/overhaul/critics/critic-specials-code-14.md"), "critic-specials-code-14.md"],
  ["Final interface critique, build 15", resolve(repo, "docs/overhaul/critics/critic-interface-15.md"), "critic-interface-15.md"],
  ["HUD shelter and label follow-up, build 15", resolve(repo, "docs/overhaul/critics/critic-specials-code-15.md"), "critic-specials-code-15.md"],
  ["Special visual review, build 14", resolve(repo, "docs/overhaul/critics/critic-visual-14-specials.md"), "critic-visual-14-specials.md"],
  ["Historical special performance, build 13", resolve(repo, "docs/overhaul/evidence/special-performance-13-summary.json"), "special-performance-13-summary.json"],
  [
    "Scripted three-leg results",
    nodeVoyageFile,
    "full-voyage-probe.results.json",
  ],
  [
    "Scripted three-leg report",
    nodeVoyageReport,
    "full-voyage-probe.report.md",
  ],
  ...(fullVoyageAttached
    ? [
        [
          "Browser full-voyage receipt",
          fullVoyageFile,
          "browser-full-voyage-receipt.json",
        ],
      ]
    : []),
  [
    "Performance summary",
    resolve(performance, "summary.json"),
    "performance-summary.json",
  ],
]) {
  if (!(await exists(path))) continue;
  if (extname(path) === ".md") {
    // Preserve source links when this gallery folder is opened on its own.
    // The viewer and images work offline; repository source links use GitHub.
    const markdown = await readFile(path, "utf8");
    const portable = markdown.replace(/(!?\[[^\]]*\])\(([^\s)]+)\)/g, (match, label, href) => {
      if (/^(?:[a-z]+:|#)/i.test(href)) return match;
      const [file, fragment] = href.split("#");
      const repositoryPath = slash(relative(repo, resolve(dirname(path), file)));
      if (repositoryPath.startsWith("../")) return match;
      const encoded = repositoryPath.split("/").map(encodeURIComponent).join("/");
      return `${label}(https://github.com/TheDudeCommits/WeAreOnTheCruise/blob/codex/cinematic-anime-overhaul/${encoded}${fragment ? `#${fragment}` : ""})`;
    });
    await writeFile(resolve(output, "evidence", localName), portable);
  } else await copyFile(path, resolve(output, "evidence", localName));
  documentLinks.push({
    label,
    url: `evidence/${localName}`,
    repositoryUrl: slash(relative(output, path)),
  });
  manifest.evidence.push({
    label,
    url: `evidence/${localName}`,
    source: slash(relative(repo, path)),
  });
}
const figure = (url, label, title, kind, caption, eager = false) =>
  `<figure class="comparison ${kind}"><figcaption><span class="type">${escape(label)}</span><span>${escape(title)}</span></figcaption><button class="image-button" data-image="${escape(url)}" data-title="${escape(title)}" aria-label="Enlarge ${escape(title)}"><img src="${escape(url)}" alt="${escape(title)}" loading="${eager ? "eager" : "lazy"}" decoding="async"><span class="enlarge" aria-hidden="true">＋ View full image</span></button><p class="image-note">${escape(caption)}</p></figure>`;
const tabs = sections
  .map(
    (s, index) =>
      `<button role="tab" id="tab-${s.id}" aria-controls="section-${s.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-section="${s.id}"><span>${s.id}</span>${escape(s.tab)}</button>`,
  )
  .join("");
const panels = sections
  .map(
    (s, index) =>
      `<section class="section-panel" id="section-${s.id}" role="tabpanel" aria-labelledby="tab-${s.id}" ${index ? "hidden" : ""}><div class="section-heading"><div><p class="eyebrow">${s.id} / ${escape(s.theme)}</p><h2>${escape(s.title)}</h2></div><span class="stage">Implementation in progress</span></div><div class="comparison-grid">${figure(s.targetUrl, "Imagegen target", s.title + " — generated art target", "target", "Generated concept illustration. Not a game screenshot or a fidelity claim.", index === 0)}${figure(s.actualUrl, "Actual engine", s.title + " — current engine capture", "actual", s.caption, index === 0)}</div><div class="section-notes"><div><h3>What the evidence shows</h3><p>${escape(s.proof)}</p></div><div><h3>Where the next pass matters</h3><p>${escape(s.next)}</p></div></div></section>`,
  )
  .join("");
const proofGallery = supplements
  .map(
    (item) =>
      `<article class="proof-card">${figure(item.url, "Actual engine", item.name, "actual", item.caption)}</article>`,
  )
  .join("");
const links = documentLinks
  .map(
    (link) =>
      `<a href="${escape(link.url)}">${escape(link.label)} <span aria-hidden="true">↗</span></a>`,
  )
  .join("");
const repoLinks = documentLinks
  .filter((link) =>
    ["Implementation review", "Section concept brief"].includes(link.label),
  )
  .map(
    (link) =>
      `<a href="${escape(link.repositoryUrl)}">${escape(link.label)} in repository</a>`,
  )
  .join(" · ");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>We Are On The Cruise — Cinematic Anime Review</title><meta name="description" content="An honest offline comparison of nine generated art targets and the current playable engine, with validation evidence and remaining gaps."><style>
:root{color-scheme:dark;--navy:#071b2c;--panel:#10283a;--line:#2d4554;--cream:#f6eedb;--muted:#b4c4cc;--gold:#edc16e;--mint:#8bd8c4}*{box-sizing:border-box}body{margin:0;background:var(--navy);color:var(--cream);font:16px/1.65 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,a{-webkit-tap-highlight-color:transparent}button{font:inherit;color:inherit}a{color:var(--gold);text-underline-offset:4px}a:hover{color:#ffe1a8}button:focus-visible,a:focus-visible{outline:3px solid var(--mint);outline-offset:4px}button{cursor:pointer}.shell{max-width:1560px;margin:auto;padding:0 40px}.masthead{display:flex;justify-content:space-between;gap:24px;align-items:center;padding:22px 0;border-bottom:1px solid var(--line);font-size:12px;letter-spacing:.14em;text-transform:uppercase}.wordmark{display:flex;gap:12px;align-items:center;font-weight:700}.compass{font-size:29px;color:var(--gold);line-height:1}.masthead a{font-size:12px}.hero{padding:64px 0 43px;display:grid;grid-template-columns:1.6fr 1fr;gap:70px;align-items:end}.eyebrow{margin:0 0 12px;color:var(--gold);font-size:12px;font-weight:650;letter-spacing:.13em;text-transform:uppercase}h1,h2{font-family:Georgia,"Times New Roman",serif;font-weight:400;line-height:1.06;letter-spacing:-.035em}h1{font-size:clamp(45px,5.2vw,78px);margin:0 0 24px;max-width:760px}h1 em{color:var(--gold);font-weight:400}.lead{font-size:17px;color:var(--muted);max-width:610px;margin:0}.hero-status{border:1px solid #7b663e;background:linear-gradient(130deg,#2c302d,#122b3e);padding:24px 26px;border-radius:5px}.status-label{display:inline-flex;align-items:center;gap:9px;color:var(--gold);font-size:11px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.status-label:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--gold)}.hero-status strong{display:block;font-size:23px;line-height:1.3;margin:10px 0}.hero-status p{margin:0;color:var(--muted);font-size:14px}.capture-meta{font-size:12px;color:#90a8b5;margin:18px 0 0}.tab-wrap{position:sticky;top:0;z-index:4;background:#071b2cf5;backdrop-filter:blur(12px);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.tabs{display:flex;overflow:auto;scrollbar-width:thin;gap:5px;padding:10px 0}.tabs button{display:flex;align-items:center;gap:10px;white-space:nowrap;border:0;background:transparent;padding:13px 16px;font-size:14px;border-radius:4px;color:var(--muted);min-height:48px}.tabs button span{font-size:11px;color:#849cab}.tabs button[aria-selected=true]{color:var(--navy);background:var(--gold);font-weight:750}.tabs button[aria-selected=true] span{color:#53606a}.section-panel{padding:40px 0 48px;scroll-margin-top:82px}[hidden]{display:none!important}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:25px}h2{font-size:clamp(31px,3vw,44px);margin:0}.stage{font-size:12px;color:var(--muted);padding:7px 11px;border:1px solid var(--line);border-radius:30px;white-space:nowrap}.comparison-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0}.comparison{border:1px solid var(--line);border-radius:5px;overflow:hidden;background:#0c2334}.comparison figcaption{display:flex;gap:12px;align-items:center;padding:15px 17px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted)}.comparison figcaption>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.type{font-size:11px;letter-spacing:.1em;font-weight:800;text-transform:uppercase;white-space:nowrap;color:var(--gold)}.actual .type{color:var(--mint)}.image-button{position:relative;display:block;padding:0;border:0;width:100%;background:#04121d;overflow:hidden;isolation:isolate}.image-button img{display:block;width:100%;aspect-ratio:16/9;height:auto;object-fit:contain}.enlarge{position:absolute;right:12px;bottom:12px;background:#061a2ce8;padding:6px 9px;border:1px solid #e8d7ae55;border-radius:3px;font-size:11px;color:#fff0cf;opacity:0;transition:opacity .15s}.image-button:hover .enlarge,.image-button:focus-visible .enlarge{opacity:1}.image-note{margin:0;padding:13px 17px;color:var(--muted);font-size:13px;line-height:1.55}.section-notes{display:grid;grid-template-columns:1fr 1fr;gap:50px;padding:25px 1px 0}.section-notes h3{font-size:13px;color:var(--gold);margin:0 0 7px}.section-notes p{color:var(--muted);font-size:14px;line-height:1.7;margin:0}.evidence{border-top:1px solid var(--line);padding:44px 0}.evidence-header{display:flex;justify-content:space-between;gap:30px;align-items:end;margin-bottom:25px}.evidence-header p{color:var(--muted);max-width:500px;margin:0;font-size:14px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.metric{background:var(--panel);border:1px solid var(--line);padding:22px;border-radius:5px}.metric strong{font-size:32px;line-height:1.1;color:var(--cream);font-weight:600;display:block;margin-bottom:9px}.metric strong small{font-size:15px;font-weight:400;color:var(--muted)}.metric b{font-size:13px;color:var(--gold)}.metric p{font-size:13px;line-height:1.6;color:var(--muted);margin:9px 0 0}.boundary{margin:18px 0 0;border-left:2px solid var(--gold);background:#182c36;padding:18px 23px;display:grid;grid-template-columns:1fr 1fr;gap:25px}.boundary p{margin:0;color:var(--muted);font-size:14px}.boundary strong{color:var(--cream)}.proof-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin:30px 0 22px}.proof-card .image-button img{aspect-ratio:16/10}.proof-card .comparison figcaption>span:last-child{display:none}.proof-card .comparison figcaption{padding:12px}.proof-card .image-note{font-size:12px;padding:12px;min-height:75px}.proof-card .enlarge{font-size:10px;right:7px;bottom:7px;opacity:1}.documents{display:flex;flex-wrap:wrap;gap:10px}.documents a{display:flex;align-items:center;gap:20px;text-decoration:none;border:1px solid var(--line);padding:10px 14px;font-size:13px;border-radius:4px;min-height:44px}.documents a:hover{background:var(--panel)}footer{border-top:1px solid var(--line);padding:25px 0 32px;color:#91a7b5;font-size:12px;display:flex;justify-content:space-between;gap:24px}.footer-repo{margin-top:8px;font-size:11px}dialog{background:#041420;color:var(--cream);border:1px solid #527082;border-radius:7px;width:calc(100vw - 48px);max-width:1800px;height:calc(100dvh - 48px);max-height:none;padding:0}dialog::backdrop{background:#010912ed;backdrop-filter:blur(7px)}.zoom-toolbar{display:flex;align-items:center;gap:15px;padding:14px 20px;border-bottom:1px solid var(--line);min-height:66px}.zoom-toolbar strong{font-size:14px;line-height:1.4;margin-right:auto}.zoom-toolbar button,.zoom-toolbar a{min-height:40px;padding:7px 13px;border:1px solid var(--line);border-radius:4px;background:var(--panel);font-size:13px;text-decoration:none;white-space:nowrap}.zoom-stage{height:calc(100% - 67px);overflow:auto;display:flex;align-items:center;justify-content:center;padding:16px}.zoom-stage img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}.zoom-stage.native{display:block}.zoom-stage.native img{max-width:none;max-height:none}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:1000px){.shell{padding:0 24px}.hero{gap:30px;padding-top:43px}.hero-status{padding:20px}.hero-status strong{font-size:20px}.metrics{grid-template-columns:1fr 1fr}.proof-grid{grid-template-columns:1fr 1fr}.tabs button{padding:12px}.section-notes{gap:25px}}@media(max-width:680px){.shell{padding:0 18px}.masthead{font-size:10px;gap:12px}.masthead>a{font-size:11px}.hero{display:block;padding:34px 0 28px}.hero-status{margin-top:25px}.lead{font-size:16px}.section-heading{display:block}.stage{display:inline-block;margin-top:15px}.comparison-grid,.section-notes,.boundary{grid-template-columns:1fr}.comparison-grid{gap:19px}.section-notes{gap:20px}.section-panel{padding-top:28px}.comparison figcaption{padding:12px}.image-note{font-size:13px}.enlarge{opacity:1}.evidence-header{display:block}.evidence-header p{margin-top:18px}.metrics{gap:10px}.metric{padding:17px}.metric strong{font-size:27px}.metric p{font-size:13px}.proof-grid{gap:10px}.proof-card .image-note{min-height:100px}footer{display:block}footer>span{display:block;margin-top:12px}dialog{width:100vw;height:100dvh;border-radius:0;border:0}.zoom-toolbar{padding:12px;flex-wrap:wrap;gap:8px}.zoom-toolbar strong{flex-basis:100%;font-size:13px}.zoom-stage{height:calc(100% - 115px);padding:8px}.tabs button{font-size:13px}.documents a{font-size:13px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}@media print{.tab-wrap,dialog,.enlarge{display:none!important}.section-panel[hidden]{display:block!important}.hero{padding-top:20px}body{background:white;color:#172d40}.shell{max-width:none;padding:0}.comparison-grid{break-inside:avoid}.section-panel{break-before:page}.comparison{border-color:#888}.image-note,.section-notes p{color:#243e50}.proof-grid{break-inside:avoid}}
</style></head><body><div class="shell"><header class="masthead"><div class="wordmark"><span class="compass" aria-hidden="true">✧</span>We Are On The Cruise</div><a href="#evidence">Review evidence ↓</a></header><section class="hero"><div><p class="eyebrow">Direction A / Cinematic anime</p><h1>A voyage in<br><em>nine frames.</em></h1><p class="lead">The approved art targets, the playable implementation, and the work still needed to bring them together. Every comparison preserves the complete image.</p></div><aside class="hero-status"><span class="status-label">Acceptance remains open</span><strong>Visual parity has not been achieved.</strong><p>The base is playable and substantially rebuilt. These screenshots show its current quality; the generated concepts set the standard for the next art pass.</p><div class="capture-meta">Visual captures: ${escape(basename(captures))} · UI: ${escape(basename(ui))} · Aim: ${escape(basename(aim))} · Progression: ${escape(basename(progression))} · Specials: ${escape(basename(specials))}</div></aside></section></div><nav class="tab-wrap" aria-label="Review sections"><div class="shell"><div class="tabs" role="tablist" aria-label="Nine art direction sections">${tabs}</div></div></nav><main class="shell">${panels}<section class="evidence" id="evidence" aria-labelledby="evidence-title"><div class="evidence-header"><div><p class="eyebrow">Evidence / limits / next decisions</p><h2 id="evidence-title">A clear line between<br>the target and the proof.</h2></div><p>Functional checks, performance measurements and art acceptance answer different questions. A passing test suite does not establish visual parity or long-term replay value.</p></div><div class="metrics"><article class="metric"><strong>${testCount ?? "Pending"}</strong><b>Automated tests recorded</b><p>${testCount === undefined ? "The final automated-test count has not been attached to this review." : "Simulation, progression, saves, input and presentation checks. The gallery does not rerun the suite."}</p></article><article class="metric"><strong>${aimCountLabel}</strong><b>Aim checks passed</b><p>${escape(aimCoverage)}</p></article><article class="metric"><strong>${performanceLabel}</strong><b>${escape(performanceTitle)}</b><p>${escape(performanceProof)}</p></article><article class="metric"><strong>0 <small>downloaded</small></strong><b>Sketchfab asset intake</b><p>1,676 catalog entries · 28 relevant ship candidates. Authentication prevented downloads. Original Blender-authored hulls and procedural crew are in use.</p></article></div><div class="boundary"><p><strong>Progression proof:</strong> ${escape(extractionProof)} ${escape(nodeVoyageProof)} ${escape(fullVoyageProof)}</p><p><strong>Mobile boundary:</strong> layouts and touch behavior were tested through browser emulation. Physical mobile performance and play quality have not been accepted.</p></div><div class="boundary"><p><strong>Special behavior:</strong> ${escape(specialProof)}</p><p><strong>Special performance:</strong> ${escape(specialPerformanceProof)}</p></div><div class="proof-grid">${proofGallery}</div><div class="documents" aria-label="Portable evidence documents">${links}<a href="manifest.json">Image provenance <span aria-hidden="true">↗</span></a></div></section><footer><div>Generated concepts are labeled. Engine screenshots are labeled. Neither substitutes for the other.${repoLinks ? `<div class="footer-repo">Repository documents: ${repoLinks}</div>` : ""}</div><span>Offline gallery · ${escape(new Date().toISOString().slice(0, 10))}</span></footer></main><dialog id="image-dialog" aria-labelledby="zoom-title"><div class="zoom-toolbar"><strong id="zoom-title">Full image</strong><button type="button" id="zoom-native" aria-pressed="false">Native size</button><a id="zoom-download" download>Download</a><button type="button" id="zoom-close" aria-label="Close full image">Close ×</button></div><div class="zoom-stage" id="zoom-stage"><img id="zoom-image" alt=""></div></dialog><div class="sr-only" aria-live="polite" id="gallery-status"></div><script>
(()=>{'use strict';const tabs=[...document.querySelectorAll('[role="tab"]')],panels=[...document.querySelectorAll('[role="tabpanel"]')];function select(id,focus=false){const active=tabs.find(t=>t.dataset.section===id)||tabs[0];tabs.forEach(tab=>{const selected=tab===active;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1});panels.forEach(panel=>{panel.hidden=panel.id!==active.getAttribute('aria-controls')});if(focus){active.focus();active.scrollIntoView({block:'nearest',inline:'nearest'})}if(location.hash!=='#evidence')history.replaceState(null,'','#section-'+active.dataset.section);document.querySelector('#gallery-status').textContent='Showing section '+active.textContent.trim()}tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>select(tab.dataset.section));tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;if(next!==undefined){event.preventDefault();select(tabs[next].dataset.section,true)}})});const initial=location.hash.match(/^#section-(\d{2})$/);if(initial)select(initial[1]);const dialog=document.querySelector('#image-dialog'),image=document.querySelector('#zoom-image'),stage=document.querySelector('#zoom-stage'),native=document.querySelector('#zoom-native');let opener;document.querySelectorAll('[data-image]').forEach(button=>button.addEventListener('click',()=>{opener=button;image.src=button.dataset.image;image.alt=button.dataset.title;document.querySelector('#zoom-title').textContent=button.dataset.title;document.querySelector('#zoom-download').href=button.dataset.image;stage.classList.remove('native');native.setAttribute('aria-pressed','false');native.textContent='Native size';dialog.showModal();document.querySelector('#zoom-close').focus()}));document.querySelector('#zoom-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{image.removeAttribute('src');opener?.focus()});dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});native.addEventListener('click',()=>{const full=stage.classList.toggle('native');native.setAttribute('aria-pressed',String(full));native.textContent=full?'Fit image':'Native size'});})();
</script></body></html>`;
await writeFile(resolve(output, "index.html"), html);
await writeFile(
  resolve(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      gallery: resolve(output, "index.html"),
      captureSet: manifest.captureSet,
      images: manifest.images.length,
      bytes: manifest.images.reduce((sum, image) => sum + image.bytes, 0),
      evidence: manifest.evidence.length,
      status: manifest.status,
    },
    null,
    2,
  ),
);
