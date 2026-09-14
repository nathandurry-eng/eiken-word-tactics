import {
  normalizeVocabulary,
  getMonths,
  getWeeks,
  buildVocabularyPool,
  parseCustomWords,
  selectByD20,
  pickDistinct,
  drawFromShuffledBag,
  validateEndTarget
} from "./game-engine.js";
import {
  makeIdentity,
  isCurrentTurn,
  claimTurnOutcome,
  guaranteedHand,
  queueForLaterReview,
  takeEligibleReview,
  captureTurnState,
  restoreTurnState,
  serializeResume,
  validateResume
} from "./session-engine.js";
import { TurnTimer } from "./timer-engine.js";
import { chooseMission } from "./mission-engine.js";

const APP_VERSION = "1.2.0";
const STORAGE = {
  settings: "eiken-word-tactics:settings:v1",
  customSets: "eiken-word-tactics:custom-sets:v1",
  recentSetup: "eiken-word-tactics:recent-setup:v1",
  resume: "eiken-word-tactics:session:v2"
};
const levelMeta = {
  "EIKEN 4": { label: "FOUNDATION", className: "foundation", note: "Extra support for the Grade 4 deck." },
  "EIKEN 3": { label: "EASY", className: "easy", note: "Build confidence with familiar speaking tasks." },
  "EIKEN Pre-2": { label: "MEDIUM", className: "medium", note: "Balance support with independent retrieval." },
  "EIKEN 2": { label: "HARD", className: "hard", note: "Explain, compare, and persuade with precision." },
  "EIKEN Pre-1": { label: "CHALLENGE", className: "challenge", note: "Sustain demanding opinions and explanations." }
};
const themeByLevel = {
  "EIKEN 4": "foundation",
  "EIKEN 3": "easy",
  "EIKEN Pre-2": "medium",
  "EIKEN 2": "hard",
  "EIKEN Pre-1": "challenge",
  Custom: "easy"
};
const modeMeta = {
  supported: { label: "SUPPORTED", time: 45, bank: 3, note: "Choose from 3 words · sentence starters · teacher-controlled help" },
  standard: { label: "STANDARD", time: 30, bank: 3, note: "One word · hidden help · 3-card Word Bank" },
  challenge: { label: "CHALLENGE", time: 20, bank: 2, note: "Harder missions · optional two-word stretch" }
};
const defaults = {
  defaultLevel: "EIKEN 3",
  defaultMode: "standard",
  timers: { supported: 45, standard: 30, challenge: 20 },
  sound: false,
  bookletMode: false,
  wordBankCount: 0,
  showJapanese: true,
  allowDefinition: true,
  allowExample: true,
  tacticCards: true
};

const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");
const offlineStatus = document.querySelector("#offline-status");
let vocabulary = [];
let missions = [];
let tacticConfig = { cardsPerPlayer: 2, tactics: [] };
const savedSettings = safeLoad(STORAGE.settings, {});
let settings = { ...defaults, ...savedSettings, timers: { ...defaults.timers, ...(savedSettings.timers || {}) } };
let customSets = safeLoad(STORAGE.customSets, []);
let setup = createInitialSetup();
let session = null;
let resumeCandidate = null;
let audioContext = null;
let lifecycleVersion = 0;
let waitingWorker = null;
const delayedCallbacks = new Set();
const turnTimer = new TurnTimer(
  (state, previous) => {
    updateTimerDisplay();
    if (state && previous && state.remaining < previous && state.remaining <= 5 && state.remaining > 0) playTick();
  },
  () => toast("Time. The teacher can judge, allow help, or use a supported retry.")
);

function safeLoad(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    queueMicrotask(() => toast("Saved browser data could not be read. The game will still work.", "warning"));
    return fallback;
  }
}

function safeSave(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    toast("This browser could not save that setting. You can keep playing.", "warning");
    return false;
  }
}

function clearSavedSession() {
  try { localStorage.removeItem(STORAGE.resume); } catch { /* Storage is optional. */ }
  resumeCandidate = null;
}

function setOfflineStatus(message) {
  if (offlineStatus) offlineStatus.textContent = message;
}

function activateWaitingUpdate() {
  if (!waitingWorker || (session && !session.ended)) return;
  waitingWorker.postMessage({ type: "ACTIVATE_UPDATE" });
  waitingWorker = null;
  setOfflineStatus("Updating after lesson…");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return setOfflineStatus("Online only");
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    const handleWaiting = (worker) => {
      waitingWorker = worker;
      if (session && !session.ended) setOfflineStatus("Update ready after lesson");
      else activateWaitingUpdate();
    };
    if (registration.waiting) handleWaiting(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) handleWaiting(worker);
      });
    });
    await navigator.serviceWorker.ready;
    if (!waitingWorker) setOfflineStatus("Offline ready");
  } catch (error) {
    console.warn("Service worker:", error);
    setOfflineStatus("Offline unavailable");
    toast("Offline setup did not finish. The online game still works.", "warning");
  }
}

function persistSession() {
  if (!session || session.ended) return clearSavedSession();
  const snapshot = serializeResume(session, APP_VERSION);
  if (snapshot) safeSave(STORAGE.resume, snapshot);
}

function cancelDelayedCallbacks() {
  lifecycleVersion += 1;
  for (const id of delayedCallbacks) clearTimeout(id);
  delayedCallbacks.clear();
}

function scheduleForCurrentTurn(callback, delay = 0) {
  const expectedLifecycle = lifecycleVersion;
  const expectedSession = session?.id;
  const expectedTurn = session?.turnId;
  const id = setTimeout(() => {
    delayedCallbacks.delete(id);
    if (expectedLifecycle !== lifecycleVersion || !isCurrentTurn(session, expectedSession, expectedTurn)) return;
    callback();
  }, delay);
  delayedCallbacks.add(id);
  return id;
}

function navigationPause({ save = true } = {}) {
  stopTimer();
  cancelDelayedCallbacks();
  if (save) persistSession();
}

function turnDuration() {
  const configured = Number(session?.settings?.timers?.[session?.config?.mode] ?? settings.timers[setup.mode]);
  return session?.config?.level === "EIKEN Pre-1" ? Math.max(60, configured) : configured;
}

function h(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function applyTheme(level = "home") {
  const theme = level === "home" ? "home" : (themeByLevel[level] || "easy");
  const colors = { home: "#173f38", foundation: "#53574d", easy: "#3f5f2d", medium: "#1c4c73", hard: "#8f241d", challenge: "#9b6a0a" };
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", colors[theme]);
}

function toast(message, tone = "info") {
  if (!toastRegion) return;
  const item = document.createElement("div");
  item.className = `toast ${tone}`;
  item.textContent = message;
  toastRegion.append(item);
  setTimeout(() => item.remove(), 4200);
}

function createInitialSetup() {
  const recent = safeLoad(STORAGE.recentSetup, {});
  return {
    level: recent.level || settings.defaultLevel,
    month: recent.month || "",
    selection: recent.selection || "week-1",
    reviewFrom: recent.reviewFrom || "",
    reviewTo: recent.reviewTo || "",
    mode: recent.mode || settings.defaultMode,
    playKind: recent.playKind || "teams",
    playerCount: Number(recent.playerCount) || 2,
    playerNames: Array.isArray(recent.playerNames) ? recent.playerNames : ["Team A", "Team B"],
    endType: recent.endType || "points",
    endTarget: Number(recent.endTarget) || 10,
    booklet: recent.booklet ?? settings.bookletMode,
    customWords: null,
    customName: ""
  };
}

function normalizeSetupForLevel() {
  if (setup.customWords?.length) {
    setup.month = "Custom";
    setup.selection = "mix";
    ensurePlayerNames();
    return;
  }
  const months = getMonths(vocabulary, setup.level);
  const thisMonth = new Intl.DateTimeFormat("en", { month: "long" }).format(new Date());
  if (!months.includes(setup.month)) setup.month = months.includes(thisMonth) ? thisMonth : months[0] || "";
  if (!months.includes(setup.reviewFrom)) setup.reviewFrom = months[Math.max(0, months.indexOf(setup.month) - 2)] || months[0] || "";
  if (!months.includes(setup.reviewTo)) setup.reviewTo = setup.month || months.at(-1) || "";
  const weeks = getWeeks(vocabulary, setup.level, setup.month);
  if (setup.selection.startsWith("week-") && !weeks.includes(Number(setup.selection.replace("week-", "")))) setup.selection = weeks.length ? `week-${weeks[0]}` : "mix";
  ensurePlayerNames();
}

function ensurePlayerNames() {
  const singular = setup.playKind === "teams" ? "Team" : "Player";
  setup.playerNames = Array.from({ length: setup.playerCount }, (_, index) => setup.playerNames[index] || `${singular} ${String.fromCharCode(65 + index)}`);
}

function renderHome() {
  navigationPause();
  applyTheme("home");
  const primary = ["EIKEN 3", "EIKEN Pre-2", "EIKEN 2", "EIKEN Pre-1"];
  const cards = primary.map((level) => levelCard(level)).join("");
  app.innerHTML = `<section class="home-view">
    <header class="setup-header">
      <p class="eyebrow">Classroom speaking game</p>
      <h1>Retrieve it.<br>Say it.</h1>
      <p class="lead">Choose a deck and get students speaking. Meanings stay hidden until help is genuinely needed.</p>
    </header>
    ${(session && !session.ended) || resumeCandidate ? `<aside class="resume-banner paper-panel"><div><strong>Paused classroom game</strong><span>Resume with the same players, words, scores, resources, and paused timer.</span></div><button class="primary-button" type="button" data-action="resume-session">Resume game</button><button class="text-button" type="button" data-action="discard-resume">Discard</button></aside>` : ""}
    <div class="level-grid">${cards}</div>
    <div class="home-tools">
      ${levelCard("EIKEN 4", true)}
      <button class="custom-entry" type="button" data-action="custom"><span aria-hidden="true">＋</span><strong>Custom word set</strong><small>Paste your own lesson words</small></button>
    </div>
    <p class="principle"><strong>Classroom rhythm:</strong> retrieve → speak → receive help if necessary</p>
  </section>`;
  focusMain();
}

function levelCard(level, compact = false) {
  const meta = levelMeta[level];
  const count = vocabulary.filter((item) => item.level === level).length;
  return `<button class="level-card ${meta.className} ${compact ? "compact" : ""}" type="button" data-action="choose-level" data-level="${h(level)}" data-theme-preview="${meta.className}" aria-label="Choose ${h(level)}, ${meta.label}">
    <span>${meta.label}</span><strong>${h(level)}</strong><small>${h(meta.note)}</small><em>${count.toLocaleString()} words</em>
  </button>`;
}

function renderSetup() {
  normalizeSetupForLevel();
  applyTheme(setup.level);
  const isCustom = Boolean(setup.customWords?.length);
  const months = isCustom ? ["Custom"] : getMonths(vocabulary, setup.level);
  const weeks = isCustom ? [] : getWeeks(vocabulary, setup.level, setup.month);
  const pool = buildVocabularyPool(vocabulary, setup);
  const monthOptions = months.map((month) => `<option value="${h(month)}" ${month === setup.month ? "selected" : ""}>${h(month)}</option>`).join("");
  const weekButtons = weeks.map((week) => choiceButton(`week-${week}`, `Week ${week}`, setup.selection)).join("");
  const names = setup.playerNames.map((name, index) => `<label><span>${setup.playKind === "teams" ? "Team" : "Player"} ${index + 1}</span><input type="text" maxlength="24" value="${h(name)}" data-player-name="${index}" aria-label="${setup.playKind === "teams" ? "Team" : "Player"} ${index + 1} name"></label>`).join("");
  const level = levelMeta[setup.level] || { label: "CUSTOM", className: "easy" };

  app.innerHTML = `<section class="setup-view ${level.className}">
    <header class="setup-titlebar">
      <button class="back-button" type="button" data-action="${isCustom ? "custom" : "home"}" aria-label="Back to ${isCustom ? "custom sets" : "level selection"}">←</button>
      <div><p class="eyebrow">${h(level.label)} DECK</p><h1>${h(isCustom ? setup.customName : setup.level)}</h1></div>
      <div class="setup-count"><strong>${pool.length.toLocaleString()}</strong><span>words ready</span></div>
    </header>
    <div class="setup-layout">
      <form class="setup-form" id="setup-form">
        <fieldset class="paper-panel setup-section">
          <legend><span>1</span> Choose the words</legend>
          ${isCustom ? `<div class="custom-set-summary"><strong>${h(setup.customName)}</strong><span>${pool.length} pasted words</span><button class="text-button" type="button" data-action="custom">Change custom set</button></div>` : `<label class="select-label"><span>Month</span><select name="month">${monthOptions}</select></label>
          <div class="segmented wrap" role="group" aria-label="Word list">${weekButtons}${choiceButton("mix", "Mix this month", setup.selection)}${choiceButton("review", "Review range", setup.selection)}</div>
          ${setup.selection === "review" ? `<div class="review-range"><label><span>From</span><select name="reviewFrom">${months.map((m) => `<option ${m === setup.reviewFrom ? "selected" : ""}>${h(m)}</option>`).join("")}</select></label><span aria-hidden="true">→</span><label><span>To</span><select name="reviewTo">${months.map((m) => `<option ${m === setup.reviewTo ? "selected" : ""}>${h(m)}</option>`).join("")}</select></label></div>` : ""}`}
        </fieldset>
        <fieldset class="paper-panel setup-section">
          <legend><span>2</span> Choose support</legend>
          <div class="mode-grid">${Object.entries(modeMeta).map(([key, meta]) => `<button class="mode-card ${setup.mode === key ? "selected" : ""}" type="button" data-action="set-mode" data-mode="${key}" aria-pressed="${setup.mode === key}"><strong>${meta.label}</strong><span>${settings.timers[key]} sec</span><small>${meta.note}</small></button>`).join("")}</div>
          <label class="switch-row"><span><strong>Use EIKEN booklet</strong><small>Show the D20 number before revealing the word</small></span><input type="checkbox" name="booklet" ${setup.booklet ? "checked" : ""}><i aria-hidden="true"></i></label>
        </fieldset>
        <fieldset class="paper-panel setup-section">
          <legend><span>3</span> Players and finish</legend>
          <div class="two-column-controls">
            <label class="select-label"><span>Play as</span><select name="playKind"><option value="teams" ${setup.playKind === "teams" ? "selected" : ""}>Teams (2–4)</option><option value="players" ${setup.playKind === "players" ? "selected" : ""}>Players (2–8)</option></select></label>
            <label class="select-label"><span>How many?</span><select name="playerCount">${countOptions()}</select></label>
          </div>
          <div class="name-grid">${names}</div>
          <div class="finish-row">
            <label class="select-label"><span>Game ends</span><select name="endType"><option value="points" ${setup.endType === "points" ? "selected" : ""}>First to points</option><option value="rounds" ${setup.endType === "rounds" ? "selected" : ""}>After rounds</option><option value="manual" ${setup.endType === "manual" ? "selected" : ""}>Teacher ends manually</option></select></label>
            ${setup.endType !== "manual" ? `<label class="select-label target-input"><span>${setup.endType === "points" ? "Points" : "Rounds"}</span><input name="endTarget" type="number" min="1" max="50" value="${setup.endTarget}"></label>` : ""}
          </div>
        </fieldset>
      </form>
      <aside class="start-card paper-panel">
        <span class="mini-crest" aria-hidden="true">英</span>
        <p class="eyebrow">READY TO PLAY</p>
        <h2>${h(isCustom ? setup.customName : `${setup.month} ${setup.selection === "mix" ? "mix" : setup.selection === "review" ? "review" : setup.selection.replace("-", " ")}`)}</h2>
        <dl><div><dt>Words</dt><dd>${pool.length}</dd></div><div><dt>Mode</dt><dd>${h(modeMeta[setup.mode].label)}</dd></div><div><dt>${setup.playKind === "teams" ? "Teams" : "Players"}</dt><dd>${setup.playerCount}</dd></div></dl>
        <button class="primary-button start-button" type="button" data-action="start-game" ${pool.length ? "" : "disabled"}>Start game <span aria-hidden="true">→</span></button>
        ${pool.length ? "" : `<p class="inline-error">No vocabulary matches this selection.</p>`}
      </aside>
    </div>
  </section>`;
  focusMain();
}

function choiceButton(value, label, selected) {
  return `<button type="button" data-action="set-selection" data-selection="${value}" aria-pressed="${selected === value}" class="${selected === value ? "selected" : ""}">${label}</button>`;
}

function countOptions() {
  const max = setup.playKind === "teams" ? 4 : 8;
  return Array.from({ length: max - 1 }, (_, index) => index + 2).map((count) => `<option value="${count}" ${setup.playerCount === count ? "selected" : ""}>${count}</option>`).join("");
}

function renderCustom() {
  applyTheme("EIKEN 3");
  const saved = customSets.map((set) => `<article class="saved-set"><div><strong>${h(set.name)}</strong><small>${set.words.length} words</small></div><button type="button" data-action="use-saved-set" data-set-id="${h(set.id)}">Use set</button><button class="danger-text" type="button" data-action="delete-saved-set" data-set-id="${h(set.id)}" aria-label="Delete ${h(set.name)}">Delete</button></article>`).join("");
  app.innerHTML = `<section class="custom-view">
    <header class="setup-titlebar"><button class="back-button" type="button" data-action="home" aria-label="Back">←</button><div><p class="eyebrow">TEACHER DECK</p><h1>Custom word set</h1></div></header>
    <div class="custom-layout">
      <form class="paper-panel custom-form" id="custom-form">
        <label><span>Set name</span><input name="setName" maxlength="40" placeholder="e.g. Unit 5 review"></label>
        <label><span>Paste words</span><textarea name="customWords" rows="12" placeholder="One word per line, comma-separated, or paste columns:\nword    part of speech    Japanese    definition    example"></textarea></label>
        <p id="custom-preview" class="parse-preview">Paste at least 2 words to make a deck.</p>
        <div class="button-row"><button class="secondary-button" type="button" data-action="save-custom">Save in this browser</button><button class="primary-button" type="button" data-action="play-custom">Use now</button></div>
      </form>
      <aside class="paper-panel saved-sets"><p class="eyebrow">SAVED SETS</p><h2>Your classroom decks</h2>${saved || "<p>No custom sets saved yet.</p>"}</aside>
    </div>
  </section>`;
  focusMain();
}

function openSettings() {
  if (session && !session.ended) { stopTimer(); persistSession(); }
  let dialog = document.querySelector("#settings-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "settings-dialog";
    dialog.className = "settings-dialog";
    document.body.append(dialog);
  }
  dialog.innerHTML = `<form method="dialog" id="settings-form">
    <header><div><p class="eyebrow">TEACHER CONTROLS</p><h2>Settings</h2></div><button class="icon-button dark" value="cancel" aria-label="Close settings">×</button></header>
    <div class="settings-body">
      <label class="select-label"><span>Default level</span><select name="defaultLevel">${Object.keys(levelMeta).map((level) => `<option ${settings.defaultLevel === level ? "selected" : ""}>${h(level)}</option>`).join("")}</select></label>
      <label class="select-label"><span>Default support mode</span><select name="defaultMode">${Object.keys(modeMeta).map((mode) => `<option value="${mode}" ${settings.defaultMode === mode ? "selected" : ""}>${modeMeta[mode].label}</option>`).join("")}</select></label>
      <div class="timer-settings"><span>Timer seconds</span>${Object.keys(modeMeta).map((mode) => `<label><small>${modeMeta[mode].label}</small><input type="number" name="timer-${mode}" min="5" max="300" value="${settings.timers[mode]}"></label>`).join("")}</div>
      <label class="select-label"><span>Word Bank cards</span><select name="wordBankCount"><option value="0" ${!settings.wordBankCount ? "selected" : ""}>Automatic by mode</option>${[3,4,5,6,7,8].map((n) => `<option value="${n}" ${settings.wordBankCount === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      ${settingSwitch("sound", "Final countdown sound", "A subtle beep during the last five seconds", settings.sound)}
      ${settingSwitch("bookletMode", "Booklet Mode by default", "Ask students to find the D20 number first", settings.bookletMode)}
      ${settingSwitch("showJapanese", "Show Japanese help", "Allow Japanese meaning to be revealed", settings.showJapanese)}
      ${settingSwitch("allowDefinition", "Allow definition help", "Allow simple English definitions", settings.allowDefinition)}
      ${settingSwitch("allowExample", "Allow example help", "Allow natural example sentences", settings.allowExample)}
      ${settingSwitch("tacticCards", "Use Tactic Cards", "Deal two scaffolding cards per player or team", settings.tacticCards)}
    </div>
    <footer><button class="secondary-button" value="cancel">Cancel</button><button class="primary-button" value="default" data-action="save-settings">Save settings</button></footer>
  </form>`;
  dialog.showModal();
}

function settingSwitch(name, label, note, checked) {
  return `<label class="switch-row"><span><strong>${label}</strong><small>${note}</small></span><input type="checkbox" name="${name}" ${checked ? "checked" : ""}><i aria-hidden="true"></i></label>`;
}

function saveSettings() {
  const form = document.querySelector("#settings-form");
  const data = new FormData(form);
  settings = {
    defaultLevel: String(data.get("defaultLevel")),
    defaultMode: String(data.get("defaultMode")),
    timers: {
      supported: clampNumber(data.get("timer-supported"), 5, 300, 45),
      standard: clampNumber(data.get("timer-standard"), 5, 300, 30),
      challenge: clampNumber(data.get("timer-challenge"), 5, 300, 20)
    },
    wordBankCount: Number(data.get("wordBankCount")) || 0,
    sound: data.has("sound"), bookletMode: data.has("bookletMode"), showJapanese: data.has("showJapanese"),
    allowDefinition: data.has("allowDefinition"), allowExample: data.has("allowExample"), tacticCards: data.has("tacticCards")
  };
  safeSave(STORAGE.settings, settings);
  setup.booklet = settings.bookletMode;
  document.querySelector("#settings-dialog")?.close();
  toast("Teacher settings saved.", "success");
}

function startGame() {
  ensurePlayerNames();
  if (setup.endType !== "manual") {
    const target = validateEndTarget(setup.endTarget);
    if (!target) return toast("Choose a whole-number finish target from 1 to 50.", "warning");
    setup.endTarget = target;
  }
  setup.playerNames = setup.playerNames.map((name, index) => name.trim() || `${setup.playKind === "teams" ? "Team" : "Player"} ${String.fromCharCode(65 + index)}`);
  const pool = buildVocabularyPool(vocabulary, setup);
  if (!pool.length) return toast("No words match this selection. Choose another list.", "warning");
  safeSave(STORAGE.recentSetup, { ...setup, customWords: undefined });
  beginSession(pool);
}

function beginSession(pool) {
  navigationPause({ save: false });
  clearSavedSession();
  const effectiveSettings = structuredClone(settings);
  const players = setup.playerNames.slice(0, setup.playerCount).map((name, index) => ({
    id: `player-${index + 1}`, name, score: 0, turns: 0, successful: 0, excellent: 0, words: [],
    tactics: effectiveSettings.tacticCards ? guaranteedHand(tacticConfig.tactics, index) : []
  }));
  session = {
    id: makeIdentity("session"), config: structuredClone(setup), settings: effectiveSettings, pool: [...pool], players, currentIndex: 0, bank: [], phase: "roll", mission: null,
    target: null, targetChoices: [], roll: null, reveals: new Set(), recentWordIds: [], recentMissionIds: [],
    encountered: new Map(), difficulties: new Map(), history: [], timer: { duration: 0, remaining: 0, running: false, deadline: null },
    judgedTurnIds: new Set(), bagState: { bag: [], lastId: "" }, reviewQueue: [], completedTurns: 0,
    swapMode: false, pendingSwapId: null, targetChangeUsed: false, supportedRetryUsed: false, attemptStarted: false,
    helpedThisTurn: false, bonusWord: null, ended: false, recall: null,
    literalD20: pool.length === 20 && (String(setup.selection).startsWith("week-") || Boolean(setup.customWords?.length))
  };
  refillBank();
  startTurn();
}

function bankCount() { return session.settings.wordBankCount || modeMeta[session.config.mode].bank; }

function refillBank() {
  const maximum = Math.max(0, Math.min(bankCount(), session.pool.length - (session.target ? 1 : 0)));
  const needed = maximum - session.bank.length;
  if (needed <= 0) return;
  const excluded = [...session.bank.map((word) => word.id), ...session.recentWordIds, session.target?.id].filter(Boolean);
  session.bank.push(...pickDistinct(session.pool, needed, excluded));
}

function startTurn() {
  stopTimer();
  cancelDelayedCallbacks();
  session.turnId = makeIdentity("turn");
  session.mission = null;
  session.phase = "roll";
  session.target = null;
  session.targetChoices = [];
  session.roll = null;
  session.reveals = new Set();
  session.swapMode = false;
  session.pendingSwapId = null;
  session.targetChangeUsed = false;
  session.supportedRetryUsed = false;
  session.attemptStarted = false;
  session.helpedThisTurn = false;
  session.bonusWord = null;
  const duration = turnDuration();
  session.timer = { duration, remaining: duration, running: false, deadline: null };
  turnTimer.attach(session.timer);
  persistSession();
  renderGame();
}

function renderGame() {
  const player = session.players[session.currentIndex];
  const config = session.config;
  const level = levelMeta[config.level] || { className: "easy", label: "CUSTOM" };
  applyTheme(config.level);
  app.innerHTML = `<section class="game-view ${level.className}">
    <header class="turn-banner"><div><span>NOW SPEAKING</span><strong>${h(player.name)}</strong><b class="current-score">${player.score} point${player.score === 1 ? "" : "s"}</b></div><div class="turn-meta"><span>${h(level.label)}</span><b>${h(modeMeta[config.mode].label)}</b></div></header>
    <div class="game-layout">
      <div class="play-column">${renderMission()}${renderTargetPanel()}${["speak", "judging"].includes(session.phase) ? renderTimerAndJudge() : ""}</div>
      <aside class="game-sidebar">${renderScoreboard()}${renderTactics(player)}${renderWordBank()}<div class="teacher-controls"><button type="button" data-action="skip-player">Skip player</button><button type="button" data-action="undo-score" ${session.history.length ? "" : "disabled"}>Undo last score</button><button type="button" data-action="manual-end">End game</button></div></aside>
    </div>
  </section>`;
  updateTimerDisplay();
}

function renderMission() {
  const mission = session.mission;
  if (!mission) return `<article class="mission-card paper-panel"><header><span class="card-kicker">MISSION CARD</span><em>DEALT AFTER THE WORD</em></header><div class="mission-copy"><h2>Target first</h2><p>The speaking mission will be matched to the word after the D20 roll.</p></div></article>`;
  const art = missionArtKey(mission);
  return `<article class="mission-card paper-panel mission-${art}" data-mission-art="${art}"><header><span class="card-kicker">MISSION CARD</span><em>${h(mission?.category || "SPEAK")}</em></header><div class="mission-copy"><h2>${h(mission?.title || "Use the word")}</h2><p>${h(mission?.prompt || "Use the target word naturally in spoken English.")}</p>${session.config.mode === "supported" && mission?.starters?.length ? `<div class="starters"><span>Try starting with</span>${mission.starters.map((starter) => `<q>${h(starter)}</q>`).join("")}</div>` : ""}${mission?.stretch?.optional && session.bonusWord ? `<p class="optional-stretch"><strong>Optional stretch:</strong> ${h(mission.stretch.prompt)}</p>` : ""}</div></article>`;
}

function missionArtKey(mission) {
  const category = String(mission?.category || "").toLowerCase();
  if (category.includes("opinion") || category.includes("agree")) return "opinion";
  if (category.includes("question") || category.includes("follow")) return "question";
  if (category.includes("answer") || category.includes("advice")) return "answer";
  if (category.includes("example") || category.includes("explain")) return "example";
  if (category.includes("story") || category.includes("experience")) return "story";
  if (category.includes("compare") || category.includes("problem") || category.includes("choose")) return "connection";
  if (category.includes("persuade") || category.includes("would")) return "combo";
  return "sentence";
}

function renderTargetPanel() {
  const config = session.config;
  if (session.phase === "roll") return `<section class="target-stage paper-panel"><p class="eyebrow">TARGET WORD</p><div class="roll-stage"><button class="d20-button" type="button" data-action="roll-d20" aria-label="Roll the twenty-sided die"><span aria-hidden="true">20</span></button><div><h2>Roll for the word</h2><p>The D20 selects from ${session.pool.length.toLocaleString()} eligible words.</p><button class="primary-button" type="button" data-action="roll-d20">Roll D20</button></div></div></section>`;
  if (session.phase === "rolling") return `<section class="target-stage paper-panel" aria-busy="true"><p class="eyebrow">THE D20 IS ROLLING</p><div class="rolling-die" aria-label="Rolling">${Math.floor(Math.random() * 20) + 1}</div></section>`;
  if (session.phase === "booklet") return `<section class="target-stage paper-panel booklet-stage"><p class="eyebrow">USE EIKEN BOOKLET</p><div class="roll-result"><span>ROLL</span><strong>${session.roll}</strong></div><h2>${h(session.target.level)} · ${h(session.target.month)} · Week ${session.target.week} · Entry ${session.target.position}</h2><p>${session.literalD20 ? "This single 20-entry list maps literally to the D20." : "For this larger or mixed pool, the D20 keeps its physical game identity while the shuffled bag guarantees fair coverage."} Give the student a moment to locate the entry.</p><button class="primary-button" type="button" data-action="reveal-word">Reveal word / continue</button></section>`;
  if (session.phase === "choose") return `<section class="target-stage paper-panel"><p class="eyebrow">CHOOSE ONE TARGET</p><h2>Which word can you use best?</h2><div class="target-choices">${session.targetChoices.map((word) => `<button type="button" data-action="choose-target" data-word-id="${h(word.id)}"><strong>${h(word.word)}</strong><span>(${h(shortPos(word.partOfSpeech))})</span></button>`).join("")}</div></section>`;
  const word = session.target;
  const wordLength = String(word.word).length;
  const wordSizeClass = wordLength > 20 ? "very-long-word" : wordLength > 14 ? "long-word" : "";
  return `<section class="target-stage paper-panel target-reveal"><header><div><p class="eyebrow">TARGET WORD · D20 ${session.roll}</p><h2 class="${wordSizeClass}" data-word-length="${wordLength}">${h(word.word)}</h2><span class="part-of-speech">(${h(shortPos(word.partOfSpeech))})</span></div></header>
    ${config.mode === "challenge" && session.bonusWord ? `<div class="bonus-word"><span>OPTIONAL TWO-WORD STRETCH</span><strong>+ ${h(session.bonusWord.word)}</strong><small>Use both only if they fit naturally</small></div>` : ""}
    <p class="help-instruction">After the first attempt, the teacher may reveal any permitted help. Help never costs points. <button class="text-button" type="button" data-action="mark-attempt" ${session.attemptStarted ? "disabled" : ""}>${session.attemptStarted ? "Initial attempt recorded" : "Record initial attempt"}</button></p>
    <div class="help-buttons">${helpButton("japanese", "日本語", session.settings.showJapanese)}${helpButton("definition", "MEANING", session.settings.allowDefinition)}${helpButton("example", "EXAMPLE", session.settings.allowExample)}</div>
    <div class="help-reveals">${revealedHelp("japanese", word.japanese, "Japanese meaning not provided.", word.japaneseExplanation)}${revealedHelp("definition", word.englishDefinition, "English definition not provided.")}${revealedHelp("example", word.example, "Example sentence not provided.")}</div>
    ${session.swapMode ? `<p class="swap-callout">Choose a highlighted Word Bank card, or <button type="button" data-action="cancel-swap">cancel safely</button>.</p>` : ""}</section>`;
}

function shortPos(pos) {
  const map = { noun: "n.", verb: "v.", adjective: "adj.", adverb: "adv.", preposition: "prep.", conjunction: "conj." };
  const clean = String(pos || "word").toLowerCase();
  return map[clean] || clean.split(";").map((part) => map[part.trim()] || part.trim()).join(" / ");
}

function helpButton(type, label, allowed) {
  if (!allowed) return "";
  const revealed = session.reveals.has(type);
  return `<button type="button" data-action="reveal-help" data-help="${type}" aria-pressed="${revealed}"><span>${revealed ? "✓" : "+"}</span>${label}${!revealed ? `<small>AFTER ATTEMPT</small>` : ""}</button>`;
}

function revealedHelp(type, value, fallback, detail = "") {
  const labels = { japanese: "❀ 日本語の意味 ❀", definition: "❀ Meaning ❀", example: "❀ Example ❀" };
  return session.reveals.has(type) ? `<div class="help-item ${type}"><span>${labels[type]}</span><div><p lang="${type === "japanese" ? "ja" : "en"}">${h(value || fallback)}</p>${type === "japanese" && detail ? `<small lang="ja">${h(detail)}</small>` : ""}</div></div>` : "";
}

function renderTimerAndJudge() {
  const locked = session.phase === "judging";
  return `<section class="turn-controls paper-panel"><div class="timer-block"><span class="timer-label">TURN TIMER</span><strong id="timer-display">${formatTime(session.timer.remaining)}</strong><div class="timer-buttons"><button type="button" data-action="timer-toggle" ${locked ? "disabled" : ""}>${session.timer.running ? "Pause" : "Start"}</button><button type="button" data-action="timer-reset" ${locked ? "disabled" : ""}>Reset</button></div></div><div class="judge-block"><span>TEACHER JUDGEMENT · one outcome</span><div><button class="judge try" type="button" data-action="judge" data-result="pass" ${locked ? "disabled" : ""}>Pass and next <b>0</b></button><button class="judge success" type="button" data-action="judge" data-result="success" ${locked ? "disabled" : ""}>Natural use + mission <b>+1</b></button><button class="judge excellent" type="button" data-action="judge" data-result="excellent" ${locked ? "disabled" : ""}>Detail, reason, or follow-up <b>+2</b></button></div>${session.attemptStarted && !session.supportedRetryUsed ? `<button class="supported-retry" type="button" data-action="supported-retry" ${locked ? "disabled" : ""}>Unscored supported retry · same word</button>` : ""}</div></section>`;
}

function renderScoreboard() {
  const config = session.config;
  return `<section class="scoreboard paper-panel"><header><span>PLAYER SCORE</span><small>${config.endType === "manual" ? "Manual finish" : `${config.endType === "points" ? "First to" : "Rounds"} ${config.endTarget}`}</small></header><ol>${session.players.map((player, index) => `<li class="${index === session.currentIndex ? "current" : ""}" ${index === session.currentIndex ? 'aria-current="true"' : ""}><span>${h(player.name)}</span><small>${index === session.currentIndex ? "NOW SPEAKING · " : ""}${player.turns} turn${player.turns === 1 ? "" : "s"}</small><strong>${player.score}</strong></li>`).join("")}</ol></section>`;
}

function renderTactics(player) {
  if (!session.settings.tacticCards) return "";
  return `<section class="tactics-panel paper-panel"><header><span>TACTIC HAND</span><small>${player.tactics.length} left</small></header><div class="tactic-list">${player.tactics.length ? player.tactics.map((card) => `<button type="button" data-action="use-tactic" data-instance-id="${h(card.instanceId)}" data-tactic-id="${h(card.id)}"><b>${h(card.icon)}</b><span><strong>${h(card.name)}</strong><small>${h(card.description)}</small></span></button>`).join("") : `<p class="empty-hand">No Tactics left.</p>`}</div></section>`;
}

function renderWordBank() {
  return `<section class="word-bank paper-panel ${session.swapMode ? "swap-active" : ""}"><header><span>WORD BANK</span><small>${session.swapMode ? "Choose a card" : `${session.bank.length} available`}</small></header><div>${session.bank.length ? session.bank.map((word, index) => `<button type="button" data-action="bank-word" data-bank-index="${index}" ${session.swapMode ? "" : "disabled"}><span class="bank-number">${index + 1}</span><strong>${h(word.word)}</strong><small>${h(shortPos(word.partOfSpeech))}</small></button>`).join("") : `<p class="empty-hand">No different words are available in this tiny pool.</p>`}</div></section>`;
}

function rollD20() {
  if (session.phase !== "roll") return;
  stopTimer();
  session.phase = "rolling";
  renderGame();
  const delay = matchMedia("(prefers-reduced-motion: reduce)").matches ? 80 : 720;
  scheduleForCurrentTurn(() => {
    session.roll = Math.floor(Math.random() * 20) + 1;
    let first = null;
    if (session.literalD20) first = selectByD20(session.pool, session.roll);
    else if (session.completedTurns > 0 && session.completedTurns % 4 === 0) first = takeEligibleReview(session);
    if (!first) {
      const draw = drawFromShuffledBag(session.pool, session.bagState);
      first = draw.word;
      session.bagState = draw.state;
    }
    if (!first) return toast("No target word is available.", "warning");
    session.target = first;
    session.targetChoices = session.config.mode === "supported" ? [first, ...pickDistinct(session.pool, 2, [first.id, ...session.recentWordIds])].sort(() => Math.random() - 0.5) : [];
    session.phase = session.config.booklet ? "booklet" : session.config.mode === "supported" && session.targetChoices.length > 1 ? "choose" : "speak";
    if (session.phase === "speak") activateTarget(first);
    persistSession();
    renderGame();
  }, delay);
}

function revealBookletWord() {
  session.phase = session.config.mode === "supported" && session.targetChoices.length > 1 ? "choose" : "speak";
  if (session.phase === "speak") activateTarget(session.target);
  renderGame();
}

function chooseTarget(id) {
  const word = session.targetChoices.find((item) => item.id === id);
  if (!word) return;
  session.phase = "speak";
  activateTarget(word);
  renderGame();
}

function activateTarget(word) {
  stopTimer();
  session.target = word;
  const duplicateBankIndex = session.bank.findIndex((item) => item.id === word.id);
  if (duplicateBankIndex >= 0) {
    session.bank.splice(duplicateBankIndex, 1);
    refillBank();
  }
  session.reveals = new Set();
  session.recentWordIds = [...session.recentWordIds.slice(-7), word.id];
  session.encountered.set(word.id, word);
  session.mission = chooseMission(missions, word, { mode: session.config.mode, level: session.config.level, recentIds: session.recentMissionIds });
  session.recentMissionIds = [...session.recentMissionIds.slice(-3), session.mission?.id].filter(Boolean);
  session.bonusWord = session.config.mode === "challenge" ? session.bank.find((item) => item.id !== word.id) || null : null;
  const duration = turnDuration();
  session.timer = { duration, remaining: duration, running: false, deadline: null };
  turnTimer.attach(session.timer);
  persistSession();
}

function markAttempt() {
  if (session?.phase !== "speak") return;
  session.attemptStarted = true;
  persistSession();
  renderGame();
  toast("Initial attempt recorded. Teacher-controlled help is now available.", "success");
}

function revealHelp(type) {
  if (session.phase !== "speak" || session.reveals.has(type)) return;
  if (!session.attemptStarted) return toast("Record the student's first attempt before revealing help.", "warning");
  stopTimer();
  session.reveals.add(type);
  session.helpedThisTurn = true;
  queueForLaterReview(session, session.target, `help:${type}`);
  persistSession();
  renderGame();
}

function consumeTactic(id, render = true) {
  const player = session.players[session.currentIndex];
  const index = player.tactics.findIndex((card) => card.id === id || card.instanceId === id);
  if (index < 0) return false;
  player.tactics.splice(index, 1);
  if (render) renderGame();
  return true;
}

function useTactic(instanceId) {
  if (session.phase !== "speak") return toast("Roll and reveal the target word first.", "warning");
  const player = session.players[session.currentIndex];
  const card = player.tactics.find((item) => item.instanceId === instanceId);
  if (!card) return;
  if (!session.attemptStarted) return toast("Use target-changing resources only after the first attempt.", "warning");
  if (card.id === "word-swap") {
    if (session.targetChangeUsed) return toast("Only one target change is allowed this turn.", "warning");
    if (!session.bank.length) return toast("No different Word Bank target is available. The swap was not spent.", "warning");
    stopTimer(); session.swapMode = true; session.pendingSwapId = instanceId; toast("Choose a Word Bank card, or cancel.");
  }
  else if (card.id === "reroll") {
    if (session.targetChangeUsed) return toast("Only one target change is allowed this turn.", "warning");
    stopTimer();
    queueForLaterReview(session, session.target, "reroll");
    consumeTactic(instanceId, false);
    session.targetChangeUsed = true;
    session.phase = "roll"; session.target = null; session.targetChoices = []; session.reveals = new Set(); session.mission = null;
  }
  else if (card.id === "extra-time") { stopTimer(); consumeTactic(instanceId, false); turnTimer.add(30); toast("30 seconds added. Timer remains paused.", "success"); }
  persistSession();
  renderGame();
}

function swapWithBank(index) {
  if (!session.swapMode || !session.bank[index]) return;
  stopTimer();
  const chosen = session.bank[index];
  const spent = session.pendingSwapId;
  if (!spent || !consumeTactic(spent, false)) return cancelSwap();
  queueForLaterReview(session, session.target, "swap");
  const replacement = pickDistinct(session.pool, 1, [...session.bank.map((item) => item.id), chosen.id, session.target?.id, ...session.recentWordIds])[0];
  if (replacement) session.bank.splice(index, 1, replacement); else session.bank.splice(index, 1);
  session.swapMode = false;
  session.pendingSwapId = null;
  session.targetChangeUsed = true;
  activateTarget(chosen);
  refillBank();
  persistSession();
  renderGame();
  toast(`${chosen.word} is now the target.`, "success");
}

function cancelSwap() {
  stopTimer();
  session.swapMode = false;
  session.pendingSwapId = null;
  persistSession();
  renderGame();
  toast("Word Swap cancelled. The resource was not spent.");
}

function toggleTimer() {
  if (session.phase !== "speak") return;
  session.attemptStarted = true;
  if (session.timer.running) stopTimer(); else turnTimer.start(session.timer);
  persistSession();
}

function stopTimer() {
  turnTimer.pause();
}

function resetTimer() {
  stopTimer();
  turnTimer.attach(session.timer);
  turnTimer.reset(turnDuration());
  persistSession();
}

function updateTimerDisplay() {
  const display = document.querySelector("#timer-display");
  if (!display || !session?.timer) return;
  display.textContent = formatTime(session.timer.remaining);
  display.classList.toggle("urgent", session.timer.remaining <= 5);
  const button = document.querySelector('[data-action="timer-toggle"]');
  if (button) button.textContent = session.timer.running ? "Pause" : "Start";
}

function formatTime(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

function playTick() {
  if (!session?.settings?.sound || !audioContext) return;
  try {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = session.timer.remaining === 1 ? 720 : 520;
    gain.gain.value = 0.025;
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + 0.07);
  } catch { /* Sound is optional. */ }
}

function judge(result) {
  if (session.phase !== "speak" || !session.target) return;
  const turnId = session.turnId;
  const before = captureTurnState(session);
  if (!claimTurnOutcome(session, turnId)) return;
  stopTimer();
  const player = session.players[session.currentIndex];
  const points = result === "excellent" ? 2 : result === "success" ? 1 : 0;
  session.history.push({ turnId, snapshot: before, result, points });
  player.score += points;
  player.turns += 1;
  session.completedTurns += 1;
  if (result !== "pass") {
    player.successful += 1;
    player.words.push(session.target.word);
    if (result === "excellent") player.excellent += 1;
  } else {
    session.difficulties.set(session.target.id, (session.difficulties.get(session.target.id) || 0) + 1);
    queueForLaterReview(session, session.target, "pass");
  }
  persistSession();
  if (shouldEndGame()) return finishGame();
  session.currentIndex = (session.currentIndex + 1) % session.players.length;
  toast(result === "excellent" ? "+2 — detail, reason, or follow-up included." : result === "success" ? "+1 — natural target use and mission complete." : "Passed. This word is queued for later review.", result === "pass" ? "info" : "success");
  scheduleForCurrentTurn(startTurn, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300);
}

function shouldEndGame() {
  const config = session.config;
  if (config.endType === "manual") return false;
  if (config.endType === "points") return session.players.some((player) => player.score >= config.endTarget);
  return session.players.every((player) => player.turns >= config.endTarget);
}

function skipPlayer() {
  stopTimer();
  cancelDelayedCallbacks();
  session.currentIndex = (session.currentIndex + 1) % session.players.length;
  startTurn();
  toast("Player skipped.");
}

function supportedRetry() {
  if (session?.phase !== "speak" || !session.target || !session.attemptStarted || session.supportedRetryUsed) return;
  stopTimer();
  cancelDelayedCallbacks();
  session.supportedRetryUsed = true;
  session.helpedThisTurn = true;
  queueForLaterReview(session, session.target, "supported-retry");
  const duration = turnDuration();
  session.timer = { duration, remaining: duration, running: false, deadline: null };
  turnTimer.attach(session.timer);
  persistSession();
  renderGame();
  toast("Supported retry ready. Same player and target; this retry is unscored.", "success");
}

function undoScore() {
  stopTimer();
  cancelDelayedCallbacks();
  const action = session?.history?.pop();
  if (!action) return;
  restoreTurnState(session, action.snapshot);
  session.id = session.id || makeIdentity("session");
  turnTimer.attach(session.timer);
  persistSession();
  renderGame();
  toast("Last outcome fully undone. Timer restored and paused.", "success");
}

function finishGame() {
  stopTimer();
  cancelDelayedCallbacks();
  session.ended = true;
  clearSavedSession();
  activateWaitingUpdate();
  const queuedIds = session.reviewQueue.filter((item) => !item.reviewed).map((item) => item.wordId);
  const difficultIds = [...session.difficulties.keys()];
  const candidateIds = [...new Set([...queuedIds, ...difficultIds])];
  const candidates = candidateIds.map((id) => session.encountered.get(id) || session.pool.find((word) => word.id === id)).filter(Boolean);
  const fallback = [...session.encountered.values()].filter((word) => !candidateIds.includes(word.id));
  const words = [...candidates, ...fallback].slice(0, 3);
  session.recall = { words, index: 0, revealed: false, remembered: 0 };
  if (words.length) renderRecall(); else renderResults();
}

function renderRecall() {
  const recall = session.recall;
  const word = recall?.words?.[recall.index];
  if (!word) return renderResults();
  applyTheme(session.config.level);
  const clue = word.japanese || word.englishDefinition || word.example || "Recall one word from this lesson.";
  app.innerHTML = `<section class="recall-view"><header class="setup-header"><p class="eyebrow">UNSCORED FINAL RECALL · ${recall.index + 1}/${recall.words.length}</p><h1>One more retrieval</h1><p class="lead">Recall the English target before showing the answer.</p></header><article class="paper-panel recall-card"><span>CLUE</span><p lang="${word.japanese ? "ja" : "en"}">${h(clue)}</p>${recall.revealed ? `<h2>${h(word.word)}</h2><small>(${h(shortPos(word.partOfSpeech))})</small><div class="button-row"><button class="primary-button" type="button" data-action="recall-next" data-remembered="true">I remembered it</button><button class="secondary-button" type="button" data-action="recall-next" data-remembered="false">Keep for review</button></div>` : `<button class="primary-button" type="button" data-action="recall-reveal">Reveal answer</button>`}</article><div class="result-actions"><button class="secondary-button" type="button" data-action="undo-score" ${session.history.length ? "" : "disabled"}>Undo final score</button><button class="text-button" type="button" data-action="skip-recall">Skip recall</button></div></section>`;
  focusMain();
}

function revealRecall() {
  if (!session.recall) return;
  session.recall.revealed = true;
  renderRecall();
}

function nextRecall(button) {
  if (!session.recall) return;
  if (button.dataset.remembered === "true") session.recall.remembered += 1;
  session.recall.index += 1;
  session.recall.revealed = false;
  renderRecall();
}

function renderResults() {
  applyTheme(session.config.level);
  const maxScore = Math.max(...session.players.map((player) => player.score));
  const winners = session.players.filter((player) => player.score === maxScore);
  const scores = [...session.players].sort((a, b) => b.score - a.score).map((player, index) => `<li><span>${index + 1}</span><div><strong>${h(player.name)}</strong><small>${player.successful} successful · ${player.excellent} excellent · ${player.turns} turns</small></div><b>${player.score}</b></li>`).join("");
  const successfulWords = session.players.flatMap((player) => player.words);
  const wordCounts = successfulWords.reduce((map, word) => map.set(word, (map.get(word) || 0) + 1), new Map());
  const mostUsed = [...wordCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const difficult = [...session.difficulties.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => session.encountered.get(id)?.word).filter(Boolean);
  const unused = session.pool.filter((word) => !session.encountered.has(word.id)).length;
  app.innerHTML = `<section class="results-view">
    <div class="winner-panel"><span class="result-crest" aria-hidden="true">勝</span><p class="eyebrow">FINAL RESULT</p><h1>${winners.length > 1 ? "It’s a tie!" : `${h(winners[0].name)} wins!`}</h1><p>${winners.map((player) => h(player.name)).join(" & ")} finished with <strong>${maxScore} point${maxScore === 1 ? "" : "s"}</strong>.</p></div>
    <div class="results-grid"><section class="paper-panel final-scores"><h2>Final scores</h2><ol>${scores}</ol></section><section class="paper-panel session-stats"><h2>Session notes</h2><dl><div><dt>Words encountered</dt><dd>${session.encountered.size}</dd></div><div><dt>Successful attempts</dt><dd>${session.players.reduce((sum, player) => sum + player.successful, 0)}</dd></div><div><dt>Excellent responses</dt><dd>${session.players.reduce((sum, player) => sum + player.excellent, 0)}</dd></div><div><dt>Final recall</dt><dd>${session.recall ? `${session.recall.remembered}/${session.recall.words.length}` : "—"}</dd></div><div><dt>Most-used word</dt><dd>${h(mostUsed?.[0] || "—")}</dd></div><div><dt>Unused in this set</dt><dd>${unused}</dd></div></dl>${difficult.length ? `<p><strong>Worth reviewing:</strong> ${difficult.map(h).join(", ")}</p>` : ""}</section></div>
    <div class="result-actions"><button class="primary-button" type="button" data-action="review-words">Quick word review</button><button class="secondary-button" type="button" data-action="undo-score" ${session.history.length ? "" : "disabled"}>Undo final score</button><button class="secondary-button" type="button" data-action="play-again">Play again · same set</button><button class="secondary-button" type="button" data-action="change-set">Change word set</button><button class="text-button" type="button" data-action="home">Home</button></div>
  </section>`;
  focusMain();
}

function renderReview() {
  applyTheme(session.config.level);
  const words = [...session.encountered.values()];
  app.innerHTML = `<section class="review-view"><header class="setup-titlebar"><button class="back-button" type="button" data-action="results" aria-label="Back to results">←</button><div><p class="eyebrow">QUICK REVIEW</p><h1>Words from this game</h1><p>Open only the support students need.</p></div></header><div class="review-list">${words.length ? words.map((word) => `<article class="paper-panel review-word"><header><div><h2>${h(word.word)}</h2><span>(${h(shortPos(word.partOfSpeech))})</span></div>${session.difficulties.has(word.id) ? `<em>TRY AGAIN</em>` : `<em>ENCOUNTERED</em>`}</header><details><summary>日本語</summary><p lang="ja">${h(word.japanese || "Japanese meaning not provided.")}</p></details><details><summary>Meaning</summary><p>${h(word.englishDefinition || "English definition not provided.")}</p></details><details><summary>Example</summary><p>${h(word.example || "Example sentence not provided.")}</p></details></article>`).join("") : `<p class="paper-panel empty-review">No words were revealed in this game.</p>`}</div><div class="result-actions"><button class="primary-button" type="button" data-action="play-again">Play again</button><button class="secondary-button" type="button" data-action="results">Back to results</button></div></section>`;
  focusMain();
}

function playCustomFromForm(save = false) {
  const form = document.querySelector("#custom-form");
  const data = new FormData(form);
  const words = parseCustomWords(data.get("customWords"));
  const name = String(data.get("setName") || "Custom lesson").trim() || "Custom lesson";
  if (words.length < 2) return toast("Add at least 2 valid words.", "warning");
  if (save) {
    const set = { id: `set-${Date.now()}`, name, words };
    customSets.push(set);
    if (safeSave(STORAGE.customSets, customSets)) { toast("Custom set saved in this browser.", "success"); renderCustom(); }
    return;
  }
  useCustomSet({ name, words });
}

function useCustomSet(set) {
  setup.customWords = set.words;
  setup.customName = set.name;
  setup.level = "Custom";
  setup.month = "Custom";
  setup.selection = "mix";
  setup.mode = settings.defaultMode;
  ensurePlayerNames();
  renderSetup();
}

function deleteCustomSet(id) {
  customSets = customSets.filter((set) => set.id !== id);
  safeSave(STORAGE.customSets, customSets);
  renderCustom();
  toast("Custom set deleted.");
}

function handleSetupChange(element) {
  if (element.matches("[data-player-name]")) { setup.playerNames[Number(element.dataset.playerName)] = element.value; return; }
  if (!element.name) return;
  const previousPlayKind = setup.playKind;
  if (element.name === "booklet") setup.booklet = element.checked;
  else if (element.name === "playerCount" || element.name === "endTarget") setup[element.name] = Number(element.value);
  else setup[element.name] = element.value;
  if (element.name === "playKind") {
    const oldLabel = previousPlayKind === "teams" ? "Team" : "Player";
    const newLabel = setup.playKind === "teams" ? "Team" : "Player";
    setup.playerNames = setup.playerNames.map((name, index) => {
      const fallback = `${oldLabel} ${String.fromCharCode(65 + index)}`;
      return !name || name === fallback ? `${newLabel} ${String.fromCharCode(65 + index)}` : name;
    });
    const max = setup.playKind === "teams" ? 4 : 8;
    setup.playerCount = Math.min(setup.playerCount, max);
  }
  if (["month", "selection", "reviewFrom", "reviewTo", "playKind", "playerCount", "endType"].includes(element.name)) renderSetup();
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function focusMain() {
  requestAnimationFrame(() => {
    const target = app.querySelector("h1, h2, button");
    if (target && !target.matches("button")) target.setAttribute("tabindex", "-1");
    target?.focus({ preventScroll: true });
    scrollTo({ top: 0, behavior: "instant" });
  });
}

function resumeSavedSession() {
  if (session && !session.ended) {
    setup = structuredClone(session.config);
  } else if (resumeCandidate) {
    session = resumeCandidate;
    resumeCandidate = null;
    setup = structuredClone(session.config);
  } else return;
  session.ended = false;
  session.timer.running = false;
  session.timer.deadline = null;
  turnTimer.attach(session.timer);
  renderGame();
  toast("Game resumed with the timer paused.", "success");
}

function discardResume() {
  navigationPause({ save: false });
  clearSavedSession();
  session = null;
  renderHome();
}

const actions = {
  home: renderHome, settings: openSettings, custom: renderCustom,
  "choose-level": (button) => { setup = { ...createInitialSetup(), level: button.dataset.level, customWords: null }; renderSetup(); },
  "set-selection": (button) => { setup.selection = button.dataset.selection; renderSetup(); },
  "set-mode": (button) => { setup.mode = button.dataset.mode; renderSetup(); },
  "start-game": startGame, "roll-d20": rollD20, "reveal-word": revealBookletWord,
  "choose-target": (button) => chooseTarget(button.dataset.wordId),
  "mark-attempt": markAttempt, "reveal-help": (button) => revealHelp(button.dataset.help),
  "use-tactic": (button) => useTactic(button.dataset.instanceId),
  "bank-word": (button) => swapWithBank(Number(button.dataset.bankIndex)), "cancel-swap": cancelSwap,
  "timer-toggle": toggleTimer, "timer-reset": resetTimer,
  judge: (button) => judge(button.dataset.result), "supported-retry": supportedRetry, "skip-player": skipPlayer, "undo-score": undoScore,
  "manual-end": finishGame, "review-words": renderReview, results: renderResults,
  "recall-reveal": revealRecall, "recall-next": nextRecall, "skip-recall": renderResults,
  "resume-session": resumeSavedSession, "discard-resume": discardResume,
  "play-again": () => beginSession(session.pool),
  "change-set": () => setup.level === "Custom" ? renderCustom() : renderSetup(),
  "save-custom": () => playCustomFromForm(true), "play-custom": () => playCustomFromForm(false),
  "use-saved-set": (button) => { const set = customSets.find((item) => item.id === button.dataset.setId); if (set) useCustomSet(set); },
  "delete-saved-set": (button) => deleteCustomSet(button.dataset.setId), "save-settings": saveSettings
};

document.addEventListener("click", (event) => {
  if (!audioContext && (window.AudioContext || window.webkitAudioContext)) {
    try { audioContext = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* Sound is optional. */ }
  } else if (audioContext?.state === "suspended") audioContext.resume().catch(() => {});
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  const action = actions[button.dataset.action];
  if (!action) return;
  event.preventDefault();
  try { action(button); } catch (error) { console.error("Game action failed:", error); toast("That action could not be completed. Please try once more.", "warning"); }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && session?.timer?.running) {
    stopTimer();
    persistSession();
    toast("Timer paused while the page was hidden. Resume it explicitly when ready.");
  }
});

document.addEventListener("change", (event) => {
  if (event.target.closest("#setup-form")) handleSetupChange(event.target);
});

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-player-name]")) handleSetupChange(event.target);
  if (event.target.closest("#setup-form") && event.target.name === "endTarget") handleSetupChange(event.target);
  if (event.target.name === "customWords") {
    const count = parseCustomWords(event.target.value).length;
    const preview = document.querySelector("#custom-preview");
    if (preview) preview.textContent = count ? `${count} word${count === 1 ? "" : "s"} detected.` : "Paste at least 2 words to make a deck.";
  }
});

async function init() {
  try {
    const [indexResponse, missionResponse, tacticResponse] = await Promise.all([fetch("./data/runtime/index.json"), fetch("./data/missions.json"), fetch("./data/tactics.json")]);
    if (!indexResponse.ok) throw new Error(`Vocabulary index request failed (${indexResponse.status}).`);
    const runtimeIndex = await indexResponse.json();
    if (!Array.isArray(runtimeIndex.levels) || !runtimeIndex.levels.length) throw new Error("Vocabulary index is invalid.");
    const levelResponses = await Promise.all(runtimeIndex.levels.map((entry) => fetch(`./data/runtime/${entry.file}`)));
    if (levelResponses.some((response) => !response.ok)) throw new Error("One or more vocabulary level files could not be loaded.");
    const levelPayloads = await Promise.all(levelResponses.map((response) => response.json()));
    vocabulary = levelPayloads.flatMap((payload) => normalizeVocabulary(payload));
    if (!vocabulary.length) throw new Error("Vocabulary data contains no usable words.");
    if (missionResponse.ok) missions = (await missionResponse.json()).missions || [];
    if (tacticResponse.ok) tacticConfig = await tacticResponse.json();
    if (!missions.length) throw new Error("Mission data contains no usable missions.");
    const saved = safeLoad(STORAGE.resume, null);
    resumeCandidate = validateResume(saved, APP_VERSION, vocabulary);
    if (!resumeCandidate && saved) clearSavedSession();
    renderHome();
    registerServiceWorker();
  } catch (error) {
    console.error("EIKEN Word Tactics startup:", error);
    app.innerHTML = `<section class="loading-card error-card"><span class="crest" aria-hidden="true">!</span><h1>The word deck could not open.</h1><p>The local data files are missing or invalid. Reload when the connection is available; a verified offline copy will continue to work after installation.</p><button class="primary-button" type="button" onclick="location.reload()">Try again</button></section>`;
  }
}

document.documentElement.dataset.version = APP_VERSION;
init();
