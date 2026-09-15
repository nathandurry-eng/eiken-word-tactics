const FALLBACK_IDS = ["example-1", "experience-1", "story-1", "followup-1", "hypothetical-1"];
const LEVEL_RANK = { "EIKEN 4": 1, "EIKEN 3": 2, "EIKEN Pre-2": 3, "EIKEN 2": 4, "EIKEN Pre-1": 5, Custom: 3 };

export function scaleMission(mission, level, mode) {
  const rank = LEVEL_RANK[level] || 3;
  const demands = rank <= 2
    ? "Level route: use the word naturally in one clear sentence and add one familiar detail."
    : rank === 3
      ? "Level route: give two or three connected sentences with a reason or example."
      : rank === 4
        ? "Level route: state a clear view or comparison, support it, and respond to one follow-up."
        : "Level route: develop the answer for about 60 seconds, include a trade-off, and respond to one challenge.";
  const preparationSeconds = rank >= 5 ? 20 : rank >= 3 ? 15 : 10;
  const listenerRole = mission.listenerRole || (/agree/i.test(mission.category)
    ? "Agree or disagree and give one reason."
    : /question|follow-up/i.test(mission.category)
      ? "Ask or answer the named question, then listen to the response."
      : "Listen for the target word, then ask one relevant follow-up.");
  return { ...mission, prompt: `${mission.prompt} ${demands}`, preparationSeconds, listenerRole, supportedRoute: mode === "supported" };
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
