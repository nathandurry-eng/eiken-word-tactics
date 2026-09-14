const FALLBACK_IDS = ["example-1", "experience-1", "story-1", "followup-1", "hypothetical-1"];
const LEVEL_RANK = { "EIKEN 4": 1, "EIKEN 3": 2, "EIKEN Pre-2": 3, "EIKEN 2": 4, "EIKEN Pre-1": 5, Custom: 3 };

export function scaleMission(mission, level, mode) {
  const rank = LEVEL_RANK[level] || 3;
  const demands = rank <= 2
    ? "Use the word naturally in one clear sentence."
    : rank === 3
      ? "Use the word naturally and add one detail."
      : rank === 4
        ? "Use the word naturally, then give a reason or relevant follow-up."
        : "Take a moment to prepare, then speak for about 60 seconds with reasons and a relevant follow-up.";
  return { ...mission, prompt: `${mission.prompt} ${demands}`, preparationSeconds: rank === 5 ? 20 : mode === "supported" ? 10 : 0 };
}

export function missionIsCompatible(mission, word, mode, level) {
  if (!mission?.modes?.includes(mode)) return false;
  if (Array.isArray(mission.levels) && !mission.levels.includes(level)) return false;
  const tags = Array.isArray(mission.compatibility) ? mission.compatibility : [];
  if (!tags.length || tags.includes("any")) return true;
  const pos = String(word?.partOfSpeech || "word").toLowerCase();
  if (tags.includes("concrete") && /^(noun|verb)/.test(pos)) return true;
  if (tags.includes("abstract") && !/proper|pronoun/.test(pos)) return true;
  return tags.some((tag) => pos.includes(tag));
}

export function chooseMission(missions, word, { mode, level, recentIds = [], random = Math.random } = {}) {
  let candidates = missions.filter((mission) => missionIsCompatible(mission, word, mode, level) && !recentIds.includes(mission.id));
  if (!candidates.length) candidates = missions.filter((mission) => missionIsCompatible(mission, word, mode, level));
  if (!candidates.length) candidates = missions.filter((mission) => FALLBACK_IDS.includes(mission.id) && mission.modes?.includes(mode));
  if (!candidates.length) candidates = missions.filter((mission) => mission.modes?.includes(mode));
  const chosen = candidates[Math.floor(random() * candidates.length)] || missions[0];
  return chosen ? scaleMission(chosen, level, mode) : null;
}
