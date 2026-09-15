const SAVE_VERSION = 2;

export function makeIdentity(prefix = "session") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isCurrentTurn(session, sessionId, turnId) {
  return Boolean(session && !session.ended && session.id === sessionId && session.turnId === turnId);
}

export function claimTurnOutcome(session, turnId) {
  if (!session || session.phase !== "speak" || !turnId || session.turnId !== turnId) return false;
  session.judgedTurnIds ||= new Set();
  if (session.judgedTurnIds.has(turnId)) return false;
  session.judgedTurnIds.add(turnId);
  session.phase = "judging";
  return true;
}

export function guaranteedHand(tactics, playerIndex = 0) {
  const swap = tactics.find((card) => card.id === "word-swap");
  const flexible = tactics.filter((card) => card.id === "reroll" || card.id === "extra-time");
  const flexCard = flexible.length ? {
    id: "flex",
    name: "FLEX CARD",
    description: "Choose Reroll or Extra Time when you use it.",
    icon: "◇",
    options: flexible.map((card) => ({ ...card }))
  } : null;
  return [swap, flexCard].filter(Boolean).map((card, index) => ({
    ...card,
    instanceId: `${card.id}-${playerIndex}-${index}-${makeIdentity("card")}`
  }));
}

export function queueForLaterReview(session, word, reason) {
  if (!session || !word?.id) return;
  session.reviewQueue ||= [];
  const existing = session.reviewQueue.find((item) => item.wordId === word.id && !item.reviewed);
  if (existing) {
    existing.reasons = [...new Set([...existing.reasons, reason])];
    return;
  }
  session.reviewQueue.push({
    wordId: word.id,
    reasons: [reason],
    eligibleAfter: (session.completedTurns || 0) + 2,
    reviewed: false
  });
}

export function takeEligibleReview(session) {
  const item = session?.reviewQueue?.find((entry) => !entry.reviewed && entry.eligibleAfter <= (session.completedTurns || 0));
  if (!item) return null;
  item.reviewed = true;
  return session.pool.find((word) => word.id === item.wordId) || null;
}

export function cloneData(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function captureTurnState(session) {
  const copy = cloneData({
    config: session.config,
    settings: session.settings,
    players: session.players,
    currentIndex: session.currentIndex,
    bank: session.bank,
    phase: session.phase,
    mission: session.mission,
    target: session.target,
    targetChoices: session.targetChoices,
    roll: session.roll,
    recentWordIds: session.recentWordIds,
    recentMissionIds: session.recentMissionIds,
    bagState: session.bagState,
    reviewQueue: session.reviewQueue,
    completedTurns: session.completedTurns,
    swapMode: session.swapMode,
    pendingSwapId: session.pendingSwapId,
    targetChangeUsed: session.targetChangeUsed,
    supportedRetryUsed: session.supportedRetryUsed,
    attemptStarted: session.attemptStarted,
    helpedThisTurn: session.helpedThisTurn,
    retryInProgress: session.retryInProgress,
    bankOpen: session.bankOpen,
    bonusWord: session.bonusWord,
    timer: session.timer,
    turnId: session.turnId,
    ended: session.ended,
    recall: session.recall,
    literalD20: session.literalD20
  });
  copy.reveals = [...(session.reveals || [])];
  copy.encountered = [...(session.encountered || [])];
  copy.difficulties = [...(session.difficulties || [])];
  copy.judgedTurnIds = [...(session.judgedTurnIds || [])];
  return copy;
}

export function restoreTurnState(session, snapshot) {
  const pool = session.pool;
  const history = session.history;
  Object.assign(session, cloneData(snapshot), { pool, history });
  session.reveals = new Set(snapshot.reveals || []);
  session.encountered = new Map(snapshot.encountered || []);
  session.difficulties = new Map(snapshot.difficulties || []);
  session.judgedTurnIds = new Set(snapshot.judgedTurnIds || []);
  session.timer = { ...session.timer, running: false, deadline: null };
  session.phase = snapshot.phase === "judging" ? (session.target ? "speak" : "roll") : (snapshot.phase || (session.target ? "speak" : "roll"));
  session.ended = false;
  return session;
}

export function serializeResume(session, appVersion) {
  if (!session || session.ended) return null;
  return {
    saveVersion: SAVE_VERSION,
    appVersion,
    savedAt: Date.now(),
    poolIds: session.pool.map((word) => word.id),
    poolData: session.config?.level === "Custom" ? session.pool : undefined,
    snapshot: captureTurnState(session),
    history: session.history.slice(-20)
  };
}

export function validateResume(value, appVersion, vocabulary) {
  if (!value || value.saveVersion !== SAVE_VERSION || value.appVersion !== appVersion) return null;
  const snapshot = value.snapshot;
  if (!Array.isArray(value.poolIds) || !value.poolIds.length || !snapshot || typeof snapshot !== "object" || !snapshot.config || !snapshot.settings || !Array.isArray(snapshot.players)) return null;
  if (!["supported", "standard", "challenge"].includes(snapshot.config.mode) || !["points", "rounds", "manual"].includes(snapshot.config.endType)) return null;
  if (!snapshot.players.length || !snapshot.players.every((player) => player && typeof player.name === "string" && Number.isFinite(player.score) && Number.isInteger(player.turns) && player.turns >= 0 && Array.isArray(player.tactics))) return null;
  if (!Number.isInteger(snapshot.currentIndex) || snapshot.currentIndex < 0 || snapshot.currentIndex >= snapshot.players.length) return null;
  if (!snapshot.timer || !Number.isFinite(snapshot.timer.remaining) || snapshot.timer.remaining < 0 || !Array.isArray(snapshot.bank) || !Array.isArray(snapshot.reviewQueue)) return null;
  const poolData = Array.isArray(value.poolData) ? value.poolData.filter((word) => word && typeof word.id === "string" && typeof word.word === "string" && word.word.trim()) : [];
  const available = [...(Array.isArray(vocabulary) ? vocabulary : []), ...poolData];
  const byId = new Map(available.map((word) => [word.id, word]));
  const pool = value.poolIds.map((id) => byId.get(id)).filter(Boolean);
  if (!pool.length || pool.length !== value.poolIds.length) return null;
  const history = Array.isArray(value.history) ? value.history.filter((entry) => entry && entry.snapshot && typeof entry.turnId === "string").slice(-20) : [];
  const session = { pool, history };
  restoreTurnState(session, snapshot);
  session.id = makeIdentity("resumed");
  return session;
}
