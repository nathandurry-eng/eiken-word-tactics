import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeVocabulary } from "../dist/game-engine.js";

const repo = process.cwd();
const root = join(repo, "dist");
const levels = ["eiken-4", "eiken-3", "eiken-pre-2", "eiken-2", "eiken-pre-1"];
const levelArt = ["easy", "medium", "hard", "challenge"].flatMap((level) =>
  ["landscape-large.webp", "landscape-medium.webp", "landscape-mobile.webp", "deck-thumbnail.webp"].map((file) => `assets/art/${level}/${file}`)
);
const tacticArt = ["reroll", "extra-time", "word-swap"].map((file) => `assets/cards/tactics/${file}.webp`);
const missionArt = ["sentence", "question", "answer", "example", "opinion", "connection", "story", "combo"].map((file) => `assets/cards/missions/${file}.webp`);
const decorArt = ["eiken-word-deck-emblem", "eiken-plaque", "nathan-seal", "paper-texture"].map((file) => `assets/decor/${file}.webp`);
const required = [
  "index.html", "styles.css", "app.js", "game-engine.js", "session-engine.js", "timer-engine.js", "mission-engine.js",
  "manifest.webmanifest", "sw.js", "icons/icon.svg", "icons/maskable.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "data/vocabulary.json", "data/vocabulary-overrides.json",
  "data/missions.json", "data/tactics.json", "data/runtime/index.json", ...levels.map((level) => `data/runtime/${level}.json`),
  ...levelArt, ...tacticArt, ...missionArt, ...decorArt, "assets/cards/covers/mission-deck.webp", "assets/cards/covers/tactic-deck.webp"
];
await Promise.all(required.map((path) => access(join(root, path))));
await access(join(repo, ".github", "workflows", "ci.yml"));

const [html, appSource, sourceText, overrideText, missionText, tacticText, manifestText, serviceWorker, assetScript] = await Promise.all([
  readFile(join(root, "index.html"), "utf8"), readFile(join(root, "app.js"), "utf8"), readFile(join(root, "data/vocabulary.json"), "utf8"),
  readFile(join(root, "data/vocabulary-overrides.json"), "utf8"), readFile(join(root, "data/missions.json"), "utf8"), readFile(join(root, "data/tactics.json"), "utf8"),
  readFile(join(root, "manifest.webmanifest"), "utf8"), readFile(join(root, "sw.js"), "utf8"), readFile(join(repo, "scripts/build-visual-assets.py"), "utf8")
]);
const sourcePayload = JSON.parse(sourceText);
const sourceRecords = Array.isArray(sourcePayload) ? sourcePayload : sourcePayload.vocabulary;
const source = normalizeVocabulary(sourcePayload);
const overrides = JSON.parse(overrideText);
const missionData = JSON.parse(missionText);
const tacticData = JSON.parse(tacticText);
const manifest = JSON.parse(manifestText);
const packageData = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
const runtimePayloads = await Promise.all(levels.map((level) => readFile(join(root, `data/runtime/${level}.json`), "utf8").then(JSON.parse)));
const runtime = runtimePayloads.flatMap((payload) => normalizeVocabulary(payload));

if (source.length !== 5460 || runtime.length !== source.length) throw new Error(`Vocabulary counts differ: source ${source.length}, runtime ${runtime.length}.`);
if (new Set(runtime.map((word) => word.id)).size !== runtime.length) throw new Error("Runtime vocabulary IDs are not unique.");
for (const word of runtime) {
  if (!word.id || !word.setId || !word.level || !word.month || !Number.isInteger(word.week) || word.week < 1 || !Number.isInteger(word.position) || word.position < 1) throw new Error(`Invalid runtime identity or location: ${word.id || "unknown"}`);
  if (word.sourceListSize && word.position > word.sourceListSize) throw new Error(`Runtime position exceeds its source list: ${word.id}`);
}
for (const level of ["EIKEN 4", "EIKEN 3", "EIKEN Pre-2", "EIKEN 2", "EIKEN Pre-1"]) {
  if (!runtime.some((item) => item.level === level)) throw new Error(`Missing runtime level: ${level}`);
}
for (const [entryId, override] of Object.entries(overrides.overrides || {})) {
  const sourceRecord = sourceRecords.find((item) => item.entry_id === entryId);
  const runtimeRecord = runtime.find((item) => item.id === entryId);
  if (!sourceRecord || !runtimeRecord) throw new Error(`Override entry is missing: ${entryId}`);
  if (sourceRecord.word !== override.word || runtimeRecord.word !== sourceRecord.word) throw new Error(`Override changed a headword: ${entryId}`);
  for (const [field, change] of Object.entries(override.changes || {})) {
    if (sourceRecord[field] !== change.before) throw new Error(`Override before-value drifted for ${entryId}.${field}`);
  }
}

if (missionData.version !== 3 || missionData.missions?.length !== 24) throw new Error("The reviewed 24-mission set is incomplete.");
if (new Set(missionData.missions.map((mission) => mission.id)).size !== 24 || missionData.missions.some((mission) => !mission.prompt || !mission.category || !mission.modes?.length || !mission.compatibility?.length)) throw new Error("Mission IDs or required routing fields are invalid.");
for (const id of ["question-1", "hypothetical-2", "persuade-2"]) {
  if (!missionData.missions.some((mission) => mission.id === id && mission.compatibility?.length)) throw new Error(`Mission review missing: ${id}`);
}
if (tacticData.version !== 2 || tacticData.tactics?.length !== 3) throw new Error("Tactic configuration must contain exactly the three retained resources.");
for (const id of ["word-swap", "reroll", "extra-time"]) if (!tacticData.tactics.some((item) => item.id === id)) throw new Error(`Missing tactic: ${id}`);
for (const removed of ["teacher-hint", "japanese-help", "definition-help", "example-help", "second-chance"]) {
  if (tacticData.tactics.some((item) => item.id === removed)) throw new Error(`Paid help tactic still present: ${removed}`);
}
for (const marker of ["claimTurnOutcome", "scheduleForCurrentTurn", "supportedRetry", "captureTurnState", "validateResume", "drawFromShuffledBag", "chooseMission", "listener-role", "CACHE_LEVEL", "parseCustomWordsDetailed"]) {
  if (!appSource.includes(marker)) throw new Error(`Required runtime behavior is missing: ${marker}`);
}
if (html.includes('id="app" tabindex="-1" aria-live') || !html.includes("toast-region")) throw new Error("Announcements must stay outside the main region.");
if (!manifest.icons?.some((icon) => icon.type === "image/png" && icon.sizes === "192x192") || !manifest.icons?.some((icon) => icon.purpose === "maskable") || manifest.display !== "standalone") throw new Error("PWA manifest is incomplete.");
if (!html.includes(`v${packageData.version}`) || !appSource.includes(`APP_VERSION = "${packageData.version}"`) || !serviceWorker.includes(`VERSION = "v${packageData.version}"`)) throw new Error("Visible, app, package, and service-worker versions do not match.");
for (const marker of ["ESSENTIAL", "OPTIONAL", "LEVEL_FILES", "CACHE_LEVEL", "event.waitUntil", 'request.mode === "navigate"', "CACHE_PREFIX", "Promise.allSettled"]) {
  if (!serviceWorker.includes(marker)) throw new Error(`Service worker cache contract is missing: ${marker}`);
}
for (const asset of ["./session-engine.js", "./timer-engine.js", "./mission-engine.js", "./data/runtime/index.json", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png"]) {
  if (!serviceWorker.includes(asset)) throw new Error(`Essential offline asset missing: ${asset}`);
}
if (!serviceWorker.includes("LEVEL_FILES.has") || !serviceWorker.includes("LEVEL_CACHED")) throw new Error("Selected-level offline caching is incomplete.");
if ((runtime.filter((word) => word.quality?.definition === "needs-review")).length !== 721) throw new Error("Sense-review fields are not preserved as the audited 721-entry suppression queue.");
const runtimeIndex = JSON.parse(await readFile(join(root, "data/runtime/index.json"), "utf8"));
if (runtimeIndex.version !== 2 || !runtimeIndex.levels.every((entry) => Array.isArray(entry.coverage?.emptyMonths))) throw new Error("Source coverage metadata is incomplete.");
if (runtimeIndex.levels.reduce((sum, entry) => sum + entry.count, 0) !== runtime.length) throw new Error("Runtime index counts do not match the generated decks.");
if (runtimeIndex.levels.reduce((sum, entry) => sum + entry.coverage.totalSets, 0) !== 180 || runtimeIndex.levels.reduce((sum, entry) => sum + entry.coverage.populatedSets, 0) !== 156) throw new Error("Audited 156/180 source coverage changed unexpectedly.");
if (!assetScript.includes("--manifest") || !assetScript.includes("--source-dir") || /C:\\\\Users\\\\/.test(assetScript)) throw new Error("Visual asset builder still depends on a hard-coded Windows source path.");

console.log(`Validated EIKEN Word Tactics v${packageData.version}: ${runtime.length.toLocaleString()} runtime words, ${missionData.missions.length} reviewed missions, ${tacticData.tactics.length} tactic behaviors, and the selected-level offline contract.`);
