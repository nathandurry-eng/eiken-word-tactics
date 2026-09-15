import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeVocabulary,
  getMonths,
  getWeeks,
  buildVocabularyPool,
  parseCustomWords,
  parseCustomWordsDetailed,
  selectByD20,
  pickDistinct,
  createShuffledBag,
  drawFromShuffledBag,
  validateEndTarget
} from "../dist/game-engine.js";

const raw = { vocabulary: [
  { entry_id: "a", level: "EIKEN 3", month: "April", month_order: "1", week: "1", word_number: "1", word: "borrow", part_of_speech: "verb", japanese_meaning: "借りる", example_sentence: "Can I borrow it?" },
  { entry_id: "b", level: "EIKEN 3", month: "April", month_order: "1", week: "2", word_number: "1", word: "return" },
  { entry_id: "c", level: "EIKEN 3", month: "May", month_order: "2", week: "1", word_number: "1", word: "improve" }
] };
const words = normalizeVocabulary(raw);

test("normalizes the master export field names and missing help", () => {
  assert.equal(words[0].japanese, "借りる");
  assert.equal(words[0].example, "Can I borrow it?");
  assert.equal(words[1].englishDefinition, "");
});

test("reads actual month and week structure", () => {
  assert.deepEqual(getMonths(words, "EIKEN 3"), ["April", "May"]);
  assert.deepEqual(getWeeks(words, "EIKEN 3", "April"), [1, 2]);
});

test("builds weekly, monthly, and review pools", () => {
  assert.equal(buildVocabularyPool(words, { level: "EIKEN 3", month: "April", selection: "week-1" }).length, 1);
  assert.equal(buildVocabularyPool(words, { level: "EIKEN 3", month: "April", selection: "mix" }).length, 2);
  assert.equal(buildVocabularyPool(words, { level: "EIKEN 3", selection: "review", reviewFrom: "April", reviewTo: "May" }).length, 3);
  assert.equal(buildVocabularyPool(words, { level: "EIKEN 3", selection: "review", reviewFrom: "May", reviewTo: "April" }).length, 0);
  assert.equal(buildVocabularyPool(words, { level: "EIKEN 3", selection: "review", reviewFrom: "Missing", reviewTo: "May" }).length, 0);
});

test("parses lines, commas, and tabular custom sets", () => {
  assert.equal(parseCustomWords("borrow\nreturn\nimprove").length, 3);
  assert.equal(parseCustomWords("borrow, return, improve").length, 3);
  const table = parseCustomWords("word\tpart of speech\tJapanese\nborrow\tverb\t借りる");
  assert.equal(table.length, 1);
  assert.equal(table[0].partOfSpeech, "verb");
  const detailed = parseCustomWordsDetailed("word\tpart of speech\nborrow\tverb\n\tmissing");
  assert.equal(detailed.words.length, 1);
  assert.equal(detailed.rejected, 1);
});

test("maps an exact 20-word deck directly to the D20", () => {
  const pool = Array.from({ length: 20 }, (_, index) => ({ id: `${index + 1}`, position: index + 1 }));
  assert.equal(selectByD20(pool, 12).id, "12");
});

test("uses non-literal uniform selection outside a single 20-entry list", () => {
  const pool = Array.from({ length: 30 }, (_, index) => ({ id: `${index + 1}`, position: index + 1 }));
  assert.equal(selectByD20(pool, 1, [], () => 0.99).position, 30);
  assert.equal(selectByD20(pool, 20, [], () => 0).position, 1);
});

test("picks unique Word Bank cards", () => {
  const selected = pickDistinct(words, 3, [], () => 0);
  assert.equal(new Set(selected.map((word) => word.id)).size, 3);
});

test("shuffled bags cover the full pool and prevent a boundary repeat", () => {
  const pool = Array.from({ length: 5 }, (_, index) => ({ id: `${index + 1}` }));
  let state = { bag: [], lastId: "" };
  const drawn = [];
  for (let index = 0; index < pool.length; index += 1) {
    const draw = drawFromShuffledBag(pool, state, () => 0);
    drawn.push(draw.word.id);
    state = draw.state;
  }
  assert.equal(new Set(drawn).size, pool.length);
  const last = drawn[drawn.length - 1];
  const nextBag = createShuffledBag(pool, () => 0, last);
  assert.notEqual(nextBag[0], last);
});

test("validates positive whole-number end targets", () => {
  assert.equal(validateEndTarget("3"), 3);
  for (const invalid of [0, -1, 1.5, "words", 51]) assert.equal(validateEndTarget(invalid), null);
});
