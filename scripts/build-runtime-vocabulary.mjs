import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const sourcePath = join(root, "dist", "data", "vocabulary.json");
const overridePath = join(root, "dist", "data", "vocabulary-overrides.json");
const outputDir = join(root, "dist", "data", "runtime");
const [sourcePayload, overridePayload] = await Promise.all([
  readFile(sourcePath, "utf8").then(JSON.parse),
  readFile(overridePath, "utf8").then(JSON.parse)
]);
const source = Array.isArray(sourcePayload) ? sourcePayload : sourcePayload.vocabulary;
if (!Array.isArray(source)) throw new Error("The authoritative vocabulary export is not a list.");
const overrides = overridePayload.overrides || {};
const slugs = { "EIKEN 4": "eiken-4", "EIKEN 3": "eiken-3", "EIKEN Pre-2": "eiken-pre-2", "EIKEN 2": "eiken-2", "EIKEN Pre-1": "eiken-pre-1" };

function corrected(record) {
  const review = overrides[record.entry_id];
  const value = { ...record };
  for (const [field, change] of Object.entries(review?.changes || {})) value[field] = change.after;
  const senseNeedsReview = String(value.review_status || "").includes("Meaning match needs review");
  const quality = {
    japanese: value.japanese_meaning ? "source" : "missing",
    definition: review?.changes?.english_definition ? "reviewed" : value.english_definition ? (senseNeedsReview ? "needs-review" : "draft") : "missing",
    japaneseExplanation: review?.changes?.japanese_explanation ? "reviewed" : value.japanese_explanation ? (senseNeedsReview ? "needs-review" : "draft") : "missing",
    example: review?.changes?.example_sentence ? "reviewed" : value.example_sentence ? (senseNeedsReview ? "needs-review" : "draft") : "missing"
  };
  return {
    id: value.entry_id,
    setId: value.set_id,
    level: value.level,
    month: value.month,
    monthOrder: Number(value.month_order),
    week: Number(value.week),
    position: Number(value.word_number),
    sourceListSize: Number(value.source_list_size),
    word: value.word,
    partOfSpeech: value.part_of_speech,
    japanese: value.japanese_meaning || "",
    englishDefinition: value.english_definition || "",
    japaneseExplanation: value.japanese_explanation || "",
    example: value.example_sentence || "",
    quality
  };
}

await mkdir(outputDir, { recursive: true });
const index = { version: 2, source: "../vocabulary.json", overrides: "../vocabulary-overrides.json", levels: [] };
for (const [level, slug] of Object.entries(slugs)) {
  const words = source.filter((record) => record.level === level).map(corrected);
  const file = `${slug}.json`;
  const sourceSets = Array.isArray(sourcePayload.set_summary) ? sourcePayload.set_summary.filter((set) => set.Level === level) : [];
  const emptyMonths = [...new Set(sourceSets.filter((set) => Number(set["Source Entries"]) === 0).map((set) => set.Month))];
  const availableMonths = [...new Set(sourceSets.filter((set) => Number(set["Source Entries"]) > 0).map((set) => set.Month))];
  const coverage = { availableMonths, emptyMonths, populatedSets: sourceSets.filter((set) => Number(set["Source Entries"]) > 0).length, totalSets: sourceSets.length };
  await writeFile(join(outputDir, file), JSON.stringify({ version: 2, level, coverage, words }));
  index.levels.push({ level, file, count: words.length, coverage });
}
await writeFile(join(outputDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`Generated ${source.length.toLocaleString()} compact runtime records from the unchanged source export.`);
