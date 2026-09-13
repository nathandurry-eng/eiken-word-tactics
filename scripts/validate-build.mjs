import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeVocabulary } from "../dist/game-engine.js";

const root = join(process.cwd(), "dist");
const levelArt = ["easy", "medium", "hard", "challenge"].flatMap((level) =>
  ["landscape-large.webp", "landscape-medium.webp", "landscape-mobile.webp", "deck-thumbnail.webp"]
    .map((file) => `assets/art/${level}/${file}`)
);
const tacticArt = ["teacher-hint", "definition-help", "japanese-help", "example-help", "reroll", "extra-time", "second-chance", "word-swap"]
  .map((file) => `assets/cards/tactics/${file}.webp`);
const missionArt = ["sentence", "question", "answer", "example", "opinion", "connection", "story", "combo"]
  .map((file) => `assets/cards/missions/${file}.webp`);
const decorArt = ["eiken-word-deck-emblem", "eiken-plaque", "nathan-seal", "paper-texture"]
  .map((file) => `assets/decor/${file}.webp`);
const required = [
  "index.html", "styles.css", "app.js", "game-engine.js", "manifest.webmanifest", "sw.js",
  "icons/icon.svg", "icons/maskable.svg", "data/vocabulary.json", "data/sample-vocabulary.json",
  "data/missions.json", "data/tactics.json", ...levelArt, ...tacticArt, ...missionArt, ...decorArt,
  "assets/cards/covers/mission-deck.webp", "assets/cards/covers/tactic-deck.webp"
];

await Promise.all(required.map((path) => access(join(root, path))));

const [html, appSource, vocabularyJson, missionJson, tacticJson, manifestJson, serviceWorker] = await Promise.all([
  readFile(join(root, "index.html"), "utf8"),
  readFile(join(root, "app.js"), "utf8"),
  readFile(join(root, "data/vocabulary.json"), "utf8"),
  readFile(join(root, "data/missions.json"), "utf8"),
  readFile(join(root, "data/tactics.json"), "utf8"),
  readFile(join(root, "manifest.webmanifest"), "utf8"),
  readFile(join(root, "sw.js"), "utf8")
]);

const vocabulary = normalizeVocabulary(JSON.parse(vocabularyJson));
const missionData = JSON.parse(missionJson);
const tacticData = JSON.parse(tacticJson);
const manifest = JSON.parse(manifestJson);

const expectedLevels = ["EIKEN 4", "EIKEN 3", "EIKEN Pre-2", "EIKEN 2", "EIKEN Pre-1"];
for (const level of expectedLevels) {
  if (!vocabulary.some((item) => item.level === level)) throw new Error(`Missing vocabulary level: ${level}`);
}
if (vocabulary.length < 100) throw new Error("Vocabulary database is unexpectedly small.");
if (!missionData.missions?.length) throw new Error("No missions found.");
const categories = new Set(missionData.missions.map((mission) => mission.category));
for (const category of ["GIVE YOUR OPINION", "AGREE OR DISAGREE", "CHOOSE", "PERSUADE", "COMPARE", "EXPLAIN", "PERSONAL EXPERIENCE", "PROBLEM + SOLUTION", "WHAT WOULD YOU DO?", "FOLLOW-UP"]) {
  if (!categories.has(category)) throw new Error(`Missing mission category: ${category}`);
}
for (const id of ["word-swap", "teacher-hint", "japanese-help", "example-help", "definition-help", "reroll", "extra-time", "second-chance"]) {
  if (!tacticData.tactics?.some((tactic) => tactic.id === id)) throw new Error(`Missing tactic: ${id}`);
  if (!appSource.includes(`card.id === "${id}"`)) throw new Error(`Tactic behavior is not implemented: ${id}`);
}
if (!html.includes("manifest.webmanifest") || !html.includes("app.js")) throw new Error("HTML entrypoint references are incomplete.");
if (!manifest.icons?.length || manifest.display !== "standalone") throw new Error("PWA manifest is incomplete.");
for (const asset of ["./app.js", "./styles.css", "./data/vocabulary.json", "./data/missions.json", "./data/tactics.json"]) {
  if (!serviceWorker.includes(asset)) throw new Error(`Service worker does not cache ${asset}`);
}
for (const asset of [...levelArt, ...tacticArt, ...missionArt, ...decorArt, "assets/cards/covers/mission-deck.webp", "assets/cards/covers/tactic-deck.webp"]) {
  if (!serviceWorker.includes(`./${asset}`)) throw new Error(`Service worker does not cache ./${asset}`);
}

console.log(`Validated EIKEN Word Tactics: ${vocabulary.length.toLocaleString()} words, ${missionData.missions.length} missions, ${tacticData.tactics.length} tactics.`);
