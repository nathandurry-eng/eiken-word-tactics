export function normalizeVocabulary(payload) {
  const items = Array.isArray(payload) ? payload : payload?.vocabulary;
  if (!Array.isArray(items)) throw new Error("Vocabulary data is not a list.");

  return items
    .filter((item) => item && typeof item.word === "string" && item.word.trim())
    .map((item, index) => ({
      id: String(item.id || item.entry_id || `word-${index + 1}`),
      level: String(item.level || "Custom"),
      month: String(item.month || "Custom"),
      monthOrder: Number(item.month_order) || 99,
      week: Number(item.week) || 1,
      position: Number(item.position || item.word_number) || index + 1,
      word: item.word.trim(),
      partOfSpeech: String(item.part_of_speech || "word"),
      japanese: String(item.japanese || item.japanese_meaning || ""),
      englishDefinition: String(item.english_definition || ""),
      japaneseExplanation: String(item.japanese_explanation || ""),
      example: String(item.example || item.example_sentence || "")
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
    const start = Math.max(0, months.indexOf(config.reviewFrom));
    const endIndex = months.indexOf(config.reviewTo);
    const end = endIndex < start ? start : endIndex;
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

export function parseCustomWords(input) {
  const text = String(input || "").trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let rows = [];

  if (lines.some((line) => line.includes("\t"))) {
    rows = lines.map((line) => line.split("\t").map((cell) => cell.trim()));
  } else if (lines.length === 1 && lines[0].includes(",")) {
    rows = lines[0].split(",").map((word) => [word.trim()]);
  } else {
    rows = lines.flatMap((line) => line.includes(",") ? line.split(",").map((word) => [word.trim()]) : [[line]]);
  }

  const headerWords = new Set(["word", "vocabulary", "english", "単語"]);
  return rows
    .filter((row) => row[0] && !headerWords.has(row[0].toLowerCase()))
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
}

export function selectByD20(pool, roll, recentIds = [], random = Math.random) {
  if (!pool.length) return null;
  if (pool.length === 20) return pool[roll - 1];
  if (pool.length < 20) return pool[(roll - 1) % pool.length];

  const recent = new Set(recentIds);
  const rawLane = pool.filter((item, index) => index % 20 === roll - 1);
  const freshLane = rawLane.filter((item) => !recent.has(item.id));
  const usable = freshLane.length ? freshLane : rawLane;
  return usable[Math.floor(random() * usable.length)];
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
