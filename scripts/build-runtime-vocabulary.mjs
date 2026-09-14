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
  const quality = {
    japanese: value.japanese_meaning ? "source" : "missing",
    definition: review?.changes?.english_definition ? "reviewed" : value.english_definition ? "draft" : "missing",
    japaneseExplanation: review?.changes?.japanese_explanation ? "reviewed" : value.japanese_explanation ? "draft" : "missing",
    example: review?.changes?.example_sentence ? "reviewed" : value.example_sentence ? "draft" : "missing"
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
const index = { version: 1, source: "../vocabulary.json", overrides: "../vocabulary-overrides.json", levels: [] };
for (const [level, slug] of Object.entries(slugs)) {
  const words = source.filter((record) => record.level === level).map(corrected);
  const file = `${slug}.json`;
  await writeFile(join(outputDir, file), JSON.stringify({ version: 1, level, words }));
  index.levels.push({ level, file, count: words.length });
}
await writeFile(join(outputDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`Generated ${source.length.toLocaleString()} compact runtime records from the unchanged source export.`);
