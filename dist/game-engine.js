export function normalizeVocabulary(payload) {
  const items = Array.isArray(payload) ? payload : payload?.vocabulary || payload?.words;
  if (!Array.isArray(items)) throw new Error("Vocabulary data is not a list.");

  return items
    .filter((item) => item && typeof item.word === "string" && item.word.trim())
    .map((item, index) => ({
      id: String(item.id || item.entry_id || `word-${index + 1}`),
      level: String(item.level || "Custom"),
      month: String(item.month || "Custom"),
      monthOrder: Number(item.monthOrder ?? item.month_order) || 99,
      week: Number(item.week) || 1,
      position: Number(item.position || item.word_number) || index + 1,
      word: item.word.trim(),
      partOfSpeech: String(item.partOfSpeech || item.part_of_speech || "word"),
      japanese: String(item.japanese || item.japanese_meaning || ""),
      englishDefinition: String(item.englishDefinition || item.english_definition || ""),
      japaneseExplanation: String(item.japaneseExplanation || item.japanese_explanation || ""),
      example: String(item.example || item.example_sentence || ""),
      setId: String(item.setId || item.set_id || ""),
      sourceListSize: Number(item.sourceListSize || item.source_list_size) || 0,
      quality: item.quality && typeof item.quality === "object" ? item.quality : {}
    }));
}

export function getMonths(vocabulary, level) {
  const seen = new Map();
  vocabulary.filter((item) => item.level === level).forEach((item) => {
    if (!seen.has(item.month)) seen.set(item.month, item.monthOrder);
  });
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([month]) => month);
}

export function getWeeks(vocabulary, level, month) {
  return [...new Set(vocabulary
    .filter((item) => item.level === level && item.month === month)
    .map((item) => item.week))].sort((a, b) => a - b);
}

export function buildVocabularyPool(vocabulary, config) {
  if (config.customWords?.length) return [...config.customWords];
  const levelWords = vocabulary.filter((item) => item.level === config.level);
  if (config.selection === "review") {
    const months = getMonths(vocabulary, config.level);
    const start = months.indexOf(config.reviewFrom);
    const end = months.indexOf(config.reviewTo);
    if (start < 0 || end < 0 || end < start) return [];
    const selectedMonths = new Set(months.slice(start, end + 1));
    return levelWords.filter((item) => selectedMonths.has(item.month));
  }
  const monthly = levelWords.filter((item) => item.month === config.month);
  if (String(config.selection).startsWith("week-")) {
    const week = Number(String(config.selection).replace("week-", ""));
    return monthly.filter((item) => item.week === week);
  }
  return monthly;
}

export function parseCustomWordsDetailed(input) {
  const text = String(input || "").trim();
  if (!text) return { words: [], rejected: 0 };
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  let rows = [];

  if (lines.some((line) => line.includes("\t"))) {
    rows = lines.map((line) => line.split("\t").map((cell) => cell.trim()));
  } else if (lines.length === 1 && lines[0].includes(",")) {
    rows = lines[0].trim().split(",").map((word) => [word.trim()]);
  } else {
    rows = lines.flatMap((line) => line.includes(",") ? line.split(",").map((word) => [word.trim()]) : [[line.trim()]]);
  }

  const headerWords = new Set(["word", "vocabulary", "english", "単語"]);
  const contentRows = rows.filter((row) => !headerWords.has(String(row[0] || "").toLowerCase()));
  const rejected = contentRows.filter((row) => !String(row[0] || "").trim()).length;
  const words = contentRows
    .filter((row) => String(row[0] || "").trim())
    .map((row, index) => ({
      id: `custom-${index + 1}-${row[0].toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      level: "Custom",
      month: "Custom",
      monthOrder: 1,
      week: 1,
      position: index + 1,
      word: row[0],
      partOfSpeech: row[1] || "word",
      japanese: row[2] || "",
      englishDefinition: row[3] || "",
      japaneseExplanation: "",
      example: row[4] || ""
    }));
  return { words, rejected };
}

export function parseCustomWords(input) {
  return parseCustomWordsDetailed(input).words;
}

export function selectByD20(pool, roll, recentIds = [], random = Math.random) {
  if (!pool.length) return null;
  const normalizedRoll = Math.min(20, Math.max(1, Number(roll) || 1));
  if (pool.length === 20) return pool[normalizedRoll - 1];
  const recent = new Set(recentIds);
  const fresh = pool.filter((item) => !recent.has(item.id));
  const usable = fresh.length ? fresh : pool;
  return usable[Math.floor(random() * usable.length)];
}

export function createShuffledBag(pool, random = Math.random, previousId = "") {
  const bag = pool.map((item) => item.id);
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [bag[index], bag[swapIndex]] = [bag[swapIndex], bag[index]];
  }
  if (bag.length > 1 && bag[0] === previousId) [bag[0], bag[1]] = [bag[1], bag[0]];
  return bag;
}

export function drawFromShuffledBag(pool, state = {}, random = Math.random) {
  if (!pool.length) return { word: null, state: { bag: [], lastId: "" } };
  const byId = new Map(pool.map((item) => [item.id, item]));
  let bag = Array.isArray(state.bag) ? state.bag.filter((id) => byId.has(id)) : [];
  if (!bag.length) bag = createShuffledBag(pool, random, state.lastId);
  const id = bag.shift();
  return { word: byId.get(id) || null, state: { bag, lastId: id } };
}

export function validateEndTarget(value) {
  const target = Number(value);
  return Number.isInteger(target) && target > 0 && target <= 50 ? target : null;
}

export function pickDistinct(pool, count, excludedIds = [], random = Math.random) {
  const excluded = new Set(excludedIds);
  const available = pool.filter((item) => !excluded.has(item.id));
  const result = [];
  while (available.length && result.length < count) {
    const index = Math.floor(random() * available.length);
    result.push(available.splice(index, 1)[0]);
  }
  return result;
}
