import test from "node:test";
import assert from "node:assert/strict";
import {
  claimTurnOutcome,
  guaranteedHand,
  isCurrentTurn,
  queueForLaterReview,
  takeEligibleReview,
  captureTurnState,
  restoreTurnState,
  serializeResume,
  validateResume
} from "../dist/session-engine.js";

function sampleSession() {
  const pool = [{ id: "a", word: "alpha" }, { id: "b", word: "beta" }];
  return {
    id: "session-1", turnId: "turn-1", phase: "speak", ended: false,
    config: { level: "EIKEN 3", mode: "standard", endType: "rounds", endTarget: 2 }, settings: { timers: { standard: 30 } }, pool,
    players: [{ name: "A", score: 0, turns: 0, tactics: [{ id: "word-swap" }] }], currentIndex: 0,
    bank: [pool[1]], mission: { id: "example-1" }, target: pool[0], targetChoices: [], roll: 4,
    recentWordIds: ["a"], recentMissionIds: [], bagState: { bag: ["b"], lastId: "a" }, reviewQueue: [], completedTurns: 0,
    reveals: new Set(), encountered: new Map([["a", pool[0]]]), difficulties: new Map(), judgedTurnIds: new Set(), history: [],
    timer: { duration: 30, remaining: 17, running: true, deadline: 1000 }, swapMode: false, pendingSwapId: null,
    targetChangeUsed: false, supportedRetryUsed: false, attemptStarted: true, helpedThisTurn: false, retryInProgress: false, bankOpen: true, bonusWord: pool[1], recall: null
  };
}

test("accepts exactly one judgment per turn ID", () => {
  const session = sampleSession();
  assert.equal(claimTurnOutcome(session, "turn-1"), true);
  session.phase = "speak";
  assert.equal(claimTurnOutcome(session, "turn-1"), false);
});

test("late callbacks cannot target ended or replaced turns", () => {
  const session = sampleSession();
  assert.equal(isCurrentTurn(session, "session-1", "turn-1"), true);
  session.ended = true;
  assert.equal(isCurrentTurn(session, "session-1", "turn-1"), false);
  session.ended = false;
  session.turnId = "turn-2";
  assert.equal(isCurrentTurn(session, "session-1", "turn-1"), false);
});

test("guarantees Word Swap plus one flexible resource", () => {
  const tactics = [{ id: "word-swap" }, { id: "reroll" }, { id: "extra-time" }];
  const hand = guaranteedHand(tactics, 0);
  assert.deepEqual(hand.map((card) => card.id), ["word-swap", "flex"]);
  assert.deepEqual(hand[1].options.map((card) => card.id), ["reroll", "extra-time"]);
});

test("later review waits for intervening turns", () => {
  const session = sampleSession();
  queueForLaterReview(session, session.target, "help");
  assert.equal(takeEligibleReview(session), null);
  session.completedTurns = 2;
  assert.equal(takeEligibleReview(session).id, "a");
});

test("undo restores scores, difficulty, bank, tactics, bonus and a paused timer", () => {
  const session = sampleSession();
  const snapshot = captureTurnState(session);
  session.players[0].score = 2;
  session.players[0].tactics = [];
  session.bank = [];
  session.difficulties.set("a", 1);
  session.bonusWord = null;
  session.ended = true;
  restoreTurnState(session, snapshot);
  assert.equal(session.players[0].score, 0);
  assert.equal(session.players[0].tactics.length, 1);
  assert.equal(session.bank.length, 1);
  assert.equal(session.difficulties.size, 0);
  assert.equal(session.bonusWord.id, "b");
  assert.equal(session.timer.remaining, 17);
  assert.equal(session.timer.running, false);
  assert.equal(session.ended, false);
});

test("versioned resume rejects malformed or stale data and recovers valid data", () => {
  const session = sampleSession();
  session.timer.running = false;
  const saved = serializeResume(session, "1.3.1");
  assert.equal(validateResume(saved, "1.1.0", session.pool), null);
  assert.equal(validateResume({ ...saved, poolIds: ["missing"] }, "1.3.1", session.pool), null);
  assert.equal(validateResume({ ...saved, snapshot: { ...saved.snapshot, currentIndex: 99 } }, "1.3.1", session.pool), null);
  assert.equal(validateResume({ ...saved, snapshot: { ...saved.snapshot, timer: null } }, "1.3.1", session.pool), null);
  const restored = validateResume(saved, "1.3.1", session.pool);
  assert.equal(restored.target.id, "a");
  assert.equal(restored.timer.running, false);
});

test("a two-word bank never invents a replacement", () => {
  const session = sampleSession();
  assert.equal(session.bank.length, 1);
  session.pool = [session.target];
  session.bank = [];
  assert.equal(session.bank.length, 0);
});
