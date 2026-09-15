import {
  normalizeVocabulary,
  getMonths,
  getWeeks,
  buildVocabularyPool,
  parseCustomWords,
  parseCustomWordsDetailed,
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
  validateResume,
  cloneData
} from "./session-engine.js";
import { TurnTimer } from "./timer-engine.js";
import { chooseMission } from "./mission-engine.js";

const APP_VERSION = "1.3.1";
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
  supported: { label: "SUPPORTED", time: 30, bank: 3, note: "Choose from 3 words · sentence starters · staged teacher help" },
  standard: { label: "STANDARD", time: 30, bank: 3, note: "One word · hidden help · 3-card Word Bank" },
  challenge: { label: "CHALLENGE", time: 30, bank: 2, note: "Harder missions · optional two-word stretch" }
};
const levelTimerFloor = { "EIKEN 4": 30, "EIKEN 3": 30, "EIKEN Pre-2": 40, "EIKEN 2": 45, "EIKEN Pre-1": 60, Custom: 40 };
const defaults = {
  defaultLevel: "EIKEN 3",
  defaultMode: "standard",
  timers: { supported: 30, standard: 30, challenge: 30 },
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
let runtimeIndex = { levels: [] };
const levelStore = new Map();
let missions = [];
let tacticConfig = { cardsPerPlayer: 2, tactics: [] };
const savedSettings = normalizeSettings(safeLoad(STORAGE.settings, {}));
let settings = savedSettings;
let customSets = normalizeCustomSets(safeLoad(STORAGE.customSets, []));
let setup = createInitialSetup();
let session = null;
let resumeCandidate = null;
let audioContext = null;
let lifecycleVersion = 0;
let waitingWorker = null;
let workerRegistration = null;
let settingsReturnFocus = null;
let refreshingForUpdate = false;
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

function normalizeSettings(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const mode = Object.prototype.hasOwnProperty.call(modeMeta, raw.defaultMode) ? raw.defaultMode : defaults.defaultMode;
  const level = Object.prototype.hasOwnProperty.call(levelMeta, raw.defaultLevel) ? raw.defaultLevel : defaults.defaultLevel;
  const timer = (key) => {
    const candidate = raw.timers?.[key];
    return candidate === null || candidate === "" || typeof candidate === "boolean" ? defaults.timers[key] : clampNumber(candidate, 0, 300, defaults.timers[key]);
  };
  return {
    ...defaults,
    defaultLevel: level,
    defaultMode: mode,
    timers: { supported: timer("supported"), standard: timer("standard"), challenge: timer("challenge") },
    wordBankCount: 0,
    ...Object.fromEntries(["sound", "bookletMode", "showJapanese", "allowDefinition", "allowExample", "tacticCards"].map((key) => [key, typeof raw[key] === "boolean" ? raw[key] : defaults[key]]))
  };
}

function normalizeCustomSets(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((set) => set && typeof set.name === "string" && Array.isArray(set.words)).map((set, index) => ({
    id: String(set.id || `saved-${index + 1}`),
    name: set.name.trim().slice(0, 40) || `Custom set ${index + 1}`,
    words: normalizeVocabulary({ words: set.words }).map((word) => ({ ...word, level: "Custom", month: "Custom" }))
  })).filter((set) => set.words.length >= 2);
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
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshingForUpdate && (!session || session.ended)) {
        refreshingForUpdate = true;
        location.reload();
      }
    });
    const registration = await navigator.serviceWorker.register("./sw.js");
    workerRegistration = registration;
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
    workerRegistration = await navigator.serviceWorker.ready;
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "LEVEL_CACHED") setOfflineStatus(`Offline ready · ${event.data.level}`);
      if (event.data?.type === "LEVEL_CACHE_FAILED") setOfflineStatus("Offline core ready · selected deck unavailable");
    });
    for (const level of levelStore.keys()) cacheCurrentLevelForOffline(level);
    if (!waitingWorker) setOfflineStatus("Offline core ready");
  } catch (error) {
    console.warn("Service worker:", error);
    setOfflineStatus("Offline unavailable");
    toast("Offline setup did not finish. The online game still works.", "warning");
  }
}

function cacheCurrentLevelForOffline(level = setup.level) {
  if (level === "Custom") return;
  const entry = runtimeIndex.levels.find((item) => item.level === level);
  const worker = workerRegistration?.active || navigator.serviceWorker?.controller;
  if (entry?.file && worker) worker.postMessage({ type: "CACHE_LEVEL", file: entry.file, level: entry.level });
}

async function loadLevel(level) {
  if (level === "Custom") return [];
  if (levelStore.has(level)) {
    vocabulary = levelStore.get(level);
    cacheCurrentLevelForOffline(level);
    return vocabulary;
  }
  const entry = runtimeIndex.levels.find((item) => item.level === level);
  if (!entry) throw new Error(`Unknown vocabulary level: ${level}`);
  const response = await fetch(`./data/runtime/${entry.file}`);
  if (!response.ok) throw new Error(`${level} deck request failed (${response.status}).`);
  const words = normalizeVocabulary(await response.json());
  if (!words.length || words.some((word) => word.level !== level)) throw new Error(`${level} deck is invalid.`);
  levelStore.set(level, words);
  vocabulary = words;
  cacheCurrentLevelForOffline(level);
  return words;
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
  if (configured === 0) return 0;
  return Math.max(levelTimerFloor[session?.config?.level || setup.level] || 30, configured);
}

function setupTimerDuration(mode = setup.mode) {
  const configured = Number(settings.timers[mode]);
  return configured === 0 ? 0 : Math.max(levelTimerFloor[setup.level] || 30, configured);
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
  const loaded = safeLoad(STORAGE.recentSetup, {});
  const recent = loaded && typeof loaded === "object" && !Array.isArray(loaded) ? loaded : {};
  const endType = ["points", "rounds", "manual"].includes(recent.endType) ? recent.endType : "rounds";
  const recentTarget = validateEndTarget(recent.endTarget);
  return {
    level: Object.prototype.hasOwnProperty.call(levelMeta, recent.level) ? recent.level : settings.defaultLevel,
    month: recent.month || "",
    selection: recent.selection || "week-1",
    reviewFrom: recent.reviewFrom || "",
    reviewTo: recent.reviewTo || "",
    mode: Object.prototype.hasOwnProperty.call(modeMeta, recent.mode) ? recent.mode : settings.defaultMode,
    playKind: ["teams", "players"].includes(recent.playKind) ? recent.playKind : "teams",
    playerCount: Math.trunc(clampNumber(recent.playerCount, 2, recent.playKind === "players" ? 8 : 4, 2)),
    playerNames: Array.isArray(recent.playerNames) ? recent.playerNames.filter((name) => typeof name === "string").slice(0, 8) : ["Team A", "Team B"],
    endType,
    endTarget: recentTarget || (endType === "rounds" ? 2 : 10),
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
  if (!months.includes(setup.reviewTo)) setup.reviewTo = setup.month || months[months.length - 1] || "";
  if (months.indexOf(setup.reviewFrom) > months.indexOf(setup.reviewTo)) [setup.reviewFrom, setup.reviewTo] = [setup.reviewTo, setup.reviewFrom];
  const weeks = getWeeks(vocabulary, setup.level, setup.month);
  if (setup.selection.startsWith("week-") && !weeks.includes(Number(setup.selection.replace("week-", "")))) setup.selection = weeks.length ? `week-${weeks[0]}` : "mix";
  ensurePlayerNames();
}

function ensurePlayerNames() {
  const singular = setup.playKind === "teams" ? "Team" : "Player";
  setup.playerNames = Array.from({ length: setup.playerCount }, (_, index) => {
    const current = setup.playerNames[index];
    const generated = /^(Team|Player) [A-H]$/.test(current || "");
    return !current || generated ? `${singular} ${String.fromCharCode(65 + index)}` : current;
  });
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
  const count = runtimeIndex.levels.find((entry) => entry.level === level)?.count || levelStore.get(level)?.length || 0;
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
  const coverage = runtimeIndex.levels.find((entry) => entry.level === setup.level)?.coverage;
  const coverageNote = coverage?.emptyMonths?.length ? `Source coverage note: no source entries for ${coverage.emptyMonths.join(" or ")}.` : "Source coverage: all listed months contain entries.";

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
          ${setup.selection === "review" ? `<div class="review-range"><label><span>From</span><select name="reviewFrom">${months.map((m) => `<option ${m === setup.reviewFrom ? "selected" : ""}>${h(m)}</option>`).join("")}</select></label><span aria-hidden="true">→</span><label><span>To</span><select name="reviewTo">${months.map((m) => `<option ${m === setup.reviewTo ? "selected" : ""}>${h(m)}</option>`).join("")}</select></label></div>` : ""}<p class="coverage-note">${h(coverageNote)}</p>`}
        </fieldset>
        <fieldset class="paper-panel setup-section">
          <legend><span>2</span> Choose support</legend>
          <div class="mode-grid">${Object.entries(modeMeta).map(([key, meta]) => { const duration = setupTimerDuration(key); return `<button class="mode-card ${setup.mode === key ? "selected" : ""}" type="button" data-action="set-mode" data-mode="${key}" aria-pressed="${setup.mode === key}"><strong>${meta.label}</strong><span>${duration ? `${duration} sec` : "Timer off"}</span><small>${meta.note}</small></button>`; }).join("")}</div>
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
            <label class="select-label"><span>Game ends</span><select name="endType"><option value="rounds" ${setup.endType === "rounds" ? "selected" : ""}>After equal rounds</option><option value="points" ${setup.endType === "points" ? "selected" : ""}>First to points (unequal-turn race)</option><option value="manual" ${setup.endType === "manual" ? "selected" : ""}>Teacher ends manually</option></select></label>
            ${setup.endType !== "manual" ? `<label class="select-label target-input"><span>${setup.endType === "points" ? "Points" : "Rounds"}</span><input name="endTarget" type="number" min="1" max="50" value="${setup.endTarget}"></label>` : ""}
          </div>
        </fieldset>
      </form>
      <aside class="start-card paper-panel">
        <span class="mini-crest" aria-hidden="true">英</span>
        <p class="eyebrow">READY TO PLAY</p>
        <h2>${h(selectionSummary())}</h2>
        <dl><div><dt>Words</dt><dd>${pool.length}</dd></div><div><dt>Mode</dt><dd>${h(modeMeta[setup.mode].label)}</dd></div><div><dt>${setup.playKind === "teams" ? "Teams" : "Players"}</dt><dd>${setup.playerCount}</dd></div><div><dt>Finish</dt><dd>${h(setup.endType === "manual" ? "Teacher" : `${setup.endTarget} ${setup.endType}`)}</dd></div></dl>
        <div class="teacher-rules"><strong>Teacher rule</strong><span>+1: intended sense + mission. +2: add detail, reason, or follow-up. Inflections are fine; derivations need teacher approval. Retry and listener response are unscored.</span></div>
        <button class="primary-button start-button" type="button" data-action="start-game" ${pool.length ? "" : "disabled"}>Start game <span aria-hidden="true">→</span></button>
        ${pool.length ? "" : `<p class="inline-error">No vocabulary matches this selection.</p>`}
      </aside>
    </div>
  </section>`;
  focusMain();
}

function selectionSummary() {
  if (setup.customWords?.length) return setup.customName;
  if (setup.selection === "review") return `${setup.level} · ${setup.reviewFrom}–${setup.reviewTo} review`;
  return `${setup.level} · ${setup.month} ${setup.selection === "mix" ? "mix" : setup.selection.replace("-", " ")}`;
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

function renderCustomPreview(input) {
  const preview = document.querySelector("#custom-preview");
  if (!preview) return;
  const parsed = parseCustomWordsDetailed(input);
  if (!parsed.words.length) {
    preview.className = "parse-preview";
    preview.textContent = "Paste at least 2 words to make a deck.";
    return;
  }
  preview.className = "parse-preview preview-ready";
  const rows = parsed.words.slice(0, 3).map((word) => `<li><strong>${h(word.word)}</strong><span>${h(word.partOfSpeech || "word")}</span><span>${h(word.japanese || "—")}</span><span>${h(word.englishDefinition || "—")}</span><span>${h(word.example || "—")}</span></li>`).join("");
  preview.innerHTML = `<strong>${parsed.words.length} word${parsed.words.length === 1 ? "" : "s"} parsed${parsed.rejected ? ` · ${parsed.rejected} malformed row${parsed.rejected === 1 ? "" : "s"} ignored` : ""}</strong><ol><li class="preview-head"><span>Word</span><span>POS</span><span>Japanese</span><span>Definition</span><span>Example</span></li>${rows}</ol>${parsed.words.length > 3 ? `<small>Showing the first 3 entries.</small>` : ""}`;
}

function openSettings() {
  settingsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (session && !session.ended) { stopTimer(); persistSession(); }
  let dialog = document.querySelector("#settings-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "settings-dialog";
    dialog.className = "settings-dialog";
    document.body.append(dialog);
  }
  dialog.innerHTML = `<form method="dialog" id="settings-form">
    <header><div><p class="eyebrow">TEACHER CONTROLS</p><h2>Settings</h2></div><button class="icon-button dark" type="button" data-action="close-settings" aria-label="Close settings">×</button></header>
    <div class="settings-body">
      <label class="select-label"><span>Default level</span><select name="defaultLevel">${Object.keys(levelMeta).map((level) => `<option ${settings.defaultLevel === level ? "selected" : ""}>${h(level)}</option>`).join("")}</select></label>
      <label class="select-label"><span>Default support mode</span><select name="defaultMode">${Object.keys(modeMeta).map((mode) => `<option value="${mode}" ${settings.defaultMode === mode ? "selected" : ""}>${modeMeta[mode].label}</option>`).join("")}</select></label>
      <div class="timer-settings"><span>Timer seconds <small>(0 turns the timer off; level minimums apply otherwise)</small></span>${Object.keys(modeMeta).map((mode) => `<label><small>${modeMeta[mode].label}</small><input type="number" name="timer-${mode}" min="0" max="300" value="${settings.timers[mode]}"></label>`).join("")}</div>
      ${settingSwitch("sound", "Final countdown sound", "A subtle beep during the last five seconds", settings.sound)}
      ${settingSwitch("bookletMode", "Booklet Mode by default", "Ask students to find the D20 number first", settings.bookletMode)}
      ${settingSwitch("showJapanese", "Show Japanese help", "Allow Japanese meaning to be revealed", settings.showJapanese)}
      ${settingSwitch("allowDefinition", "Allow definition help", "Allow source English definitions that are not flagged for sense review", settings.allowDefinition)}
      ${settingSwitch("allowExample", "Allow example help", "Allow source example sentences that are not flagged for sense review", settings.allowExample)}
      ${settingSwitch("tacticCards", "Use Tactic Cards", "Deal Word Swap plus one choose-on-use Flex Card", settings.tacticCards)}
    </div>
    <footer><button class="secondary-button" type="button" data-action="close-settings">Cancel</button><button class="primary-button" type="button" data-action="save-settings">Save settings</button></footer>
  </form>`;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else { dialog.setAttribute("open", ""); dialog.setAttribute("role", "dialog"); }
}

function settingSwitch(name, label, note, checked) {
  return `<label class="switch-row"><span><strong>${label}</strong><small>${note}</small></span><input type="checkbox" name="${name}" ${checked ? "checked" : ""}><i aria-hidden="true"></i></label>`;
}

function saveSettings() {
  const form = document.querySelector("#settings-form");
  const data = new FormData(form);
  settings = normalizeSettings({
    defaultLevel: String(data.get("defaultLevel")),
    defaultMode: String(data.get("defaultMode")),
    timers: {
      supported: clampNumber(data.get("timer-supported"), 0, 300, 30),
      standard: clampNumber(data.get("timer-standard"), 0, 300, 30),
      challenge: clampNumber(data.get("timer-challenge"), 0, 300, 30)
    },
    wordBankCount: 0,
    sound: data.has("sound"), bookletMode: data.has("bookletMode"), showJapanese: data.has("showJapanese"),
    allowDefinition: data.has("allowDefinition"), allowExample: data.has("allowExample"), tacticCards: data.has("tacticCards")
  });
  safeSave(STORAGE.settings, settings);
  setup.booklet = settings.bookletMode;
  closeSettings();
  toast("Teacher settings saved.", "success");
}

function closeSettings() {
  const dialog = document.querySelector("#settings-dialog");
  if (typeof dialog?.close === "function") dialog.close(); else dialog?.removeAttribute("open");
  settingsReturnFocus?.focus?.({ preventScroll: true });
  settingsReturnFocus = null;
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
  const effectiveSettings = cloneData(settings);
  const players = setup.playerNames.slice(0, setup.playerCount).map((name, index) => ({
    id: `player-${index + 1}`, name, score: 0, turns: 0, successful: 0, excellent: 0, words: [],
    tactics: effectiveSettings.tacticCards ? guaranteedHand(tacticConfig.tactics, index) : []
  }));
  session = {
    id: makeIdentity("session"), config: cloneData(setup), settings: effectiveSettings, pool: [...pool], players, currentIndex: 0, bank: [], phase: "roll", mission: null,
    target: null, targetChoices: [], roll: null, reveals: new Set(), recentWordIds: [], recentMissionIds: [],
    encountered: new Map(), difficulties: new Map(), history: [], timer: { duration: 0, remaining: 0, running: false, deadline: null },
    judgedTurnIds: new Set(), bagState: { bag: [], lastId: "" }, reviewQueue: [], completedTurns: 0,
    swapMode: false, pendingSwapId: null, targetChangeUsed: false, supportedRetryUsed: false, attemptStarted: false,
    helpedThisTurn: false, retryInProgress: false, bankOpen: setup.mode !== "supported", bonusWord: null, ended: false, recall: null,
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
  session.retryInProgress = false;
  session.bankOpen = session.config.mode !== "supported";
  session.bonusWord = null;
  const duration = turnDuration();
  session.timer = { duration, remaining: duration, running: false, deadline: null };
  turnTimer.attach(session.timer);
  persistSession();
  renderGame();
  focusAction('[data-action="roll-d20"]');
}

function renderGame() {
  const player = session.players[session.currentIndex];
  const config = session.config;
  const level = levelMeta[config.level] || { className: "easy", label: "CUSTOM" };
  applyTheme(config.level);
  app.innerHTML = `<section class="game-view ${level.className}">
    <header class="turn-banner"><div><span>NOW SPEAKING</span><strong>${h(player.name)}</strong><b class="current-score">${player.score} point${player.score === 1 ? "" : "s"}</b></div><div class="turn-meta"><span>${h(config.level === "Custom" ? "CUSTOM DECK" : config.level)}</span><b>${h(modeMeta[config.mode].label)} MODE</b></div></header>
    <p class="sr-only" aria-live="polite">${h(player.name)} is speaking${session.phase === "choose" ? `. Choose one of ${session.targetChoices.length} target words` : session.target ? ` with target word ${session.target.word}` : ". Target not drawn yet"}.</p>
    <div class="game-layout">
      <div class="play-column">${renderMission()}${renderTargetPanel()}${["speak", "judging"].includes(session.phase) ? renderTimerAndJudge() : ""}</div>
      <aside class="game-sidebar">${renderScoreboard()}${renderTactics(player)}${renderWordBank()}<div class="teacher-rule-mini"><strong>Score response</strong><span>+1 intended sense + mission · +2 add detail/reason/follow-up · retry and listener are unscored</span></div><div class="teacher-controls"><button type="button" data-action="skip-player">Pass this turn</button><button type="button" data-action="undo-score" ${session.history.length ? "" : "disabled"}>Undo last score</button><button type="button" data-action="manual-end">End game</button></div></aside>
    </div>
  </section>`;
  updateTimerDisplay();
}

function renderMission() {
  const mission = session.mission;
  if (!mission) return `<article class="mission-card paper-panel"><header><span class="card-kicker">MISSION CARD</span><em>DEALT AFTER THE WORD</em></header><div class="mission-copy"><h2>Target first</h2><p>The speaking mission will be matched to the word after the D20 roll.</p></div></article>`;
  const art = missionArtKey(mission);
  const listener = session.players[(session.currentIndex + 1) % session.players.length];
  return `<article class="mission-card paper-panel mission-${art}" data-mission-art="${art}"><header><span class="card-kicker">MISSION CARD</span><em>${h(mission?.category || "SPEAK")}</em></header><div class="mission-copy"><h2>${h(mission?.title || "Use the word")}</h2><p>${h(mission?.prompt || "Use the target word naturally in spoken English.")}</p><p class="listener-role"><strong>Listener · ${h(listener.name)} (unscored):</strong> ${h(mission.listenerRole)}</p>${mission.scoringNote ? `<p class="scoring-note"><strong>Scoring:</strong> ${h(mission.scoringNote)}</p>` : ""}${session.config.mode === "supported" && mission?.starters?.length ? `<div class="starters"><span>Try starting with</span>${mission.starters.map((starter) => `<q>${h(starter)}</q>`).join("")}</div>` : ""}${mission?.stretch?.optional && session.bonusWord ? `<p class="optional-stretch"><strong>Optional stretch:</strong> ${h(mission.stretch.prompt)}</p>` : ""}</div></article>`;
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
  if (session.phase === "roll") return `<section class="target-stage paper-panel"><p class="eyebrow">TARGET WORD</p><div class="roll-stage"><button class="d20-button" type="button" data-action="roll-d20" aria-label="Roll the twenty-sided die"><span aria-hidden="true">20</span></button><div><h2>Roll for the word</h2><p>${session.literalD20 ? "The D20 maps exactly to this 20-entry list." : `The D20 adds the classroom flourish; a shuffled bag fairly draws from ${session.pool.length.toLocaleString()} eligible words.`}</p><button class="primary-button" type="button" data-action="roll-d20">Roll D20</button></div></div></section>`;
  if (session.phase === "rolling") return `<section class="target-stage paper-panel" aria-busy="true"><p class="eyebrow">THE D20 IS ROLLING</p><div class="rolling-die" aria-label="Rolling">${Math.floor(Math.random() * 20) + 1}</div></section>`;
  if (session.phase === "booklet") return `<section class="target-stage paper-panel booklet-stage"><p class="eyebrow">USE EIKEN BOOKLET</p><div class="roll-result"><span>ROLL</span><strong>${session.roll}</strong></div><h2>${h(session.target.level)} · ${h(session.target.month)} · Week ${session.target.week} · Entry ${session.target.position}</h2><p>${session.literalD20 ? "This single 20-entry list maps literally to the D20." : "For this larger or mixed pool, the D20 keeps its physical game identity while the shuffled bag guarantees fair coverage."} Give the student a moment to locate the entry.</p><button class="primary-button" type="button" data-action="reveal-word">Reveal word / continue</button></section>`;
  if (session.phase === "choose") return `<section class="target-stage paper-panel"><p class="eyebrow">CHOOSE ONE TARGET</p><h2>Which word can you use best?</h2><div class="target-choices">${session.targetChoices.map((word) => `<button type="button" data-action="choose-target" data-word-id="${h(word.id)}"><strong>${h(word.word)}</strong><span>(${h(shortPos(word.partOfSpeech))})</span></button>`).join("")}</div></section>`;
  const word = session.target;
  const wordLength = String(word.word).length;
  const wordSizeClass = wordLength > 20 ? "very-long-word" : wordLength > 14 ? "long-word" : "";
  return `<section class="target-stage paper-panel target-reveal"><header><div><p class="eyebrow">TARGET WORD · D20 ${session.roll}</p><h2 class="${wordSizeClass}" data-word-length="${wordLength}">${h(word.word)}</h2><span class="part-of-speech">(${h(shortPos(word.partOfSpeech))})</span></div></header>
    ${config.mode === "challenge" && session.bonusWord ? `<div class="bonus-word"><span>OPTIONAL TWO-WORD STRETCH</span><strong>+ ${h(session.bonusWord.word)}</strong><small>Use both only if they fit naturally</small></div>` : ""}
    <p class="help-instruction">Try from memory first. Then use one short cue and retry; reveal the model example only if still needed. Help never costs points. <button class="text-button" type="button" data-action="mark-attempt" ${session.attemptStarted ? "disabled" : ""}>${session.attemptStarted ? `${session.retryInProgress ? "Retry" : "Initial"} attempt recorded` : `Record ${session.retryInProgress ? "retry" : "initial"} attempt`}</button></p>
    <div class="help-buttons">${helpButton("hint", "TEACHER HINT", true)}${helpButton("japanese", "日本語", session.settings.showJapanese && Boolean(word.japanese))}${helpButton("definition", "MEANING", session.settings.allowDefinition && helpIsUsable(word, "definition"))}${helpButton("example", "EXAMPLE", session.settings.allowExample && helpIsUsable(word, "example"), session.reveals.has("hint") || session.reveals.has("japanese") || session.reveals.has("definition"))}</div>
    <div class="help-reveals">${revealedHelp("hint", "Give one short situation, gesture, or meaning cue. Do not make the full sentence.", "")}${revealedHelp("japanese", word.japanese, "Japanese meaning not provided.", helpIsUsable(word, "japaneseExplanation") ? word.japaneseExplanation : "")}${revealedHelp("definition", word.englishDefinition, "English definition not provided.")}${revealedHelp("example", word.example, "Example sentence not provided.")}</div>
    ${session.swapMode ? `<p class="swap-callout">Choose a highlighted Word Bank card, or <button type="button" data-action="cancel-swap">cancel safely</button>.</p>` : ""}</section>`;
}

function shortPos(pos) {
  const map = { noun: "n.", verb: "v.", adjective: "adj.", adverb: "adv.", preposition: "prep.", conjunction: "conj." };
  const clean = String(pos || "word").toLowerCase();
  return map[clean] || clean.split(";").map((part) => map[part.trim()] || part.trim()).join(" / ");
}

function helpIsUsable(word, field) {
  const value = field === "definition" ? word.englishDefinition : field === "example" ? word.example : word.japaneseExplanation;
  return Boolean(value) && word.quality?.[field] !== "needs-review";
}

function helpButton(type, label, allowed, sequenceReady = true) {
  if (!allowed) return "";
  const revealed = session.reveals.has(type);
  const enabled = session.attemptStarted && sequenceReady;
  return `<button type="button" data-action="reveal-help" data-help="${type}" aria-pressed="${revealed}" ${revealed || !enabled ? "disabled" : ""}><span>${revealed ? "✓" : "+"}</span>${label}${!revealed ? `<small>${type === "example" && !sequenceReady ? "AFTER A CUE" : "AFTER ATTEMPT"}</small>` : ""}</button>`;
}

function revealedHelp(type, value, fallback, detail = "") {
  const labels = { hint: "❀ Teacher hint ❀", japanese: "❀ 日本語の意味 ❀", definition: "❀ Meaning ❀", example: "❀ Example ❀" };
  return session.reveals.has(type) ? `<div class="help-item ${type}"><span>${labels[type]}</span><div><p lang="${type === "japanese" ? "ja" : "en"}">${h(value || fallback)}</p>${type === "japanese" && detail ? `<small lang="ja">${h(detail)}</small>` : ""}</div></div>` : "";
}

function renderTimerAndJudge() {
  const locked = session.phase === "judging";
  const timerOff = session.timer.duration === 0;
  const outcomes = session.retryInProgress
    ? `<button class="judge try" type="button" data-action="judge" data-result="pass" ${locked ? "disabled" : ""}>Pass retry and next <b>0</b></button><button class="judge success" type="button" data-action="judge" data-result="success" ${locked ? "disabled" : ""}>Retry met the target <b>0</b></button>`
    : `<button class="judge try" type="button" data-action="judge" data-result="pass" ${locked ? "disabled" : ""}>Pass and next <b>0</b></button><button class="judge success" type="button" data-action="judge" data-result="success" ${locked ? "disabled" : ""}>Intended sense + mission <b>+1</b></button><button class="judge excellent" type="button" data-action="judge" data-result="excellent" ${locked ? "disabled" : ""}>Detail, reason, or follow-up <b>+2</b></button>`;
  return `<section class="turn-controls paper-panel"><div class="timer-block"><span class="timer-label">TURN TIMER</span><strong id="timer-display">${formatTime(session.timer.remaining, timerOff)}</strong><div class="timer-buttons"><button type="button" data-action="timer-toggle" ${locked || timerOff ? "disabled" : ""}>${timerOff ? "Off" : session.timer.running ? "Pause" : "Start"}</button><button type="button" data-action="timer-reset" ${locked || timerOff ? "disabled" : ""}>Reset</button></div></div><div class="judge-block"><span>${session.retryInProgress ? "UNSCORED RETRY" : "SCORE RESPONSE"} · one outcome</span><div class="${session.retryInProgress ? "retry-outcomes" : ""}">${outcomes}</div>${session.attemptStarted && !session.supportedRetryUsed ? `<button class="supported-retry" type="button" data-action="supported-retry" ${locked ? "disabled" : ""}>Unscored retry · same speaker and word</button>` : ""}</div></section>`;
}

function renderScoreboard() {
  const config = session.config;
  return `<section class="scoreboard paper-panel"><header><span>PLAYER SCORE</span><small>${config.endType === "manual" ? "Manual finish" : config.endType === "points" ? `Unequal-turn race · first to ${config.endTarget}` : `${config.endTarget} equal round${config.endTarget === 1 ? "" : "s"}`}</small></header><ol>${session.players.map((player, index) => `<li class="${index === session.currentIndex ? "current" : ""}" ${index === session.currentIndex ? 'aria-current="true"' : ""}><span>${h(player.name)}</span><small>${index === session.currentIndex ? "NOW SPEAKING · " : ""}${player.turns} turn${player.turns === 1 ? "" : "s"}</small><strong>${player.score}</strong></li>`).join("")}</ol></section>`;
}

function renderTactics(player) {
  if (!session.settings.tacticCards) return "";
  return `<section class="tactics-panel paper-panel"><header><span>TACTIC HAND</span><small>${player.tactics.length} left</small></header><div class="tactic-list">${player.tactics.length ? player.tactics.map((card) => card.id === "flex" ? `<div class="flex-card"><b>${h(card.icon)}</b><span><strong>${h(card.name)}</strong><small>${h(card.description)}</small></span><div><button type="button" data-action="use-tactic" data-instance-id="${h(card.instanceId)}" data-tactic-choice="reroll">Reroll</button><button type="button" data-action="use-tactic" data-instance-id="${h(card.instanceId)}" data-tactic-choice="extra-time">+30 sec</button></div></div>` : `<button type="button" data-action="use-tactic" data-instance-id="${h(card.instanceId)}" data-tactic-id="${h(card.id)}"><b>${h(card.icon)}</b><span><strong>${h(card.name)}</strong><small>${h(card.description)}</small></span></button>`).join("") : `<p class="empty-hand">No Tactics left.</p>`}</div></section>`;
}

function renderWordBank() {
  const collapsed = session.config.mode === "supported" && !session.bankOpen && !session.swapMode;
  return `<section class="word-bank paper-panel ${session.swapMode ? "swap-active" : ""} ${collapsed ? "collapsed" : ""}"><header><span>WORD BANK</span><small>${session.swapMode ? "Choose a card" : `${session.bank.length} available`}</small>${session.config.mode === "supported" ? `<button type="button" data-action="toggle-bank" ${!session.attemptStarted && collapsed ? "disabled" : ""}>${collapsed ? "Open choices" : "Hide choices"}</button>` : ""}</header>${collapsed ? `<p class="empty-hand">Open only after the first attempt if choices would help.</p>` : `<div>${session.bank.length ? session.bank.map((word, index) => `<button type="button" data-action="bank-word" data-bank-index="${index}" ${session.swapMode ? "" : "disabled"}><span class="bank-number">${index + 1}</span><strong>${h(word.word)}</strong><small>${h(shortPos(word.partOfSpeech))}</small></button>`).join("") : `<p class="empty-hand">No different words are available in this tiny pool.</p>`}</div>`}</section>`;
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
    if (session.config.mode === "supported") {
      const choices = [first, ...pickDistinct(session.pool, 2, [first.id, ...session.recentWordIds])];
      session.targetChoices = pickDistinct(choices, choices.length);
    } else session.targetChoices = [];
    session.phase = session.config.booklet ? "booklet" : session.config.mode === "supported" && session.targetChoices.length > 1 ? "choose" : "speak";
    if (session.phase === "speak") activateTarget(first);
    persistSession();
    renderGame();
    focusAction('[data-action="reveal-word"], [data-action="choose-target"], [data-action="mark-attempt"]');
  }, delay);
}

function revealBookletWord() {
  session.phase = session.config.mode === "supported" && session.targetChoices.length > 1 ? "choose" : "speak";
  if (session.phase === "speak") activateTarget(session.target);
  renderGame();
  focusAction('[data-action="choose-target"], [data-action="mark-attempt"]');
}

function chooseTarget(id) {
  const word = session.targetChoices.find((item) => item.id === id);
  if (!word) return;
  session.phase = "speak";
  activateTarget(word);
  renderGame();
  focusAction('[data-action="mark-attempt"]');
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
  focusAction('[data-action="reveal-help"]:not([disabled])');
  toast(`${session.retryInProgress ? "Retry" : "Initial"} attempt recorded. Teacher-controlled help is now available.`, "success");
}

function revealHelp(type) {
  if (session.phase !== "speak" || session.reveals.has(type)) return;
  if (!session.attemptStarted) return toast("Record the student's first attempt before revealing help.", "warning");
  if (type === "example" && !["hint", "japanese", "definition"].some((item) => session.reveals.has(item))) return toast("Give one short cue before revealing the model example.", "warning");
  stopTimer();
  session.reveals.add(type);
  session.helpedThisTurn = true;
  queueForLaterReview(session, session.target, `help:${type}`);
  persistSession();
  renderGame();
  focusAction(type === "example" ? '[data-action="supported-retry"]' : '[data-help="example"]:not([disabled]), [data-action="supported-retry"]');
}

function consumeTactic(id, render = true) {
  const player = session.players[session.currentIndex];
  const index = player.tactics.findIndex((card) => card.id === id || card.instanceId === id);
  if (index < 0) return false;
  player.tactics.splice(index, 1);
  if (render) renderGame();
  return true;
}

function useTactic(instanceId, choice = "") {
  if (session.phase !== "speak") return toast("Roll and reveal the target word first.", "warning");
  const player = session.players[session.currentIndex];
  const card = player.tactics.find((item) => item.instanceId === instanceId);
  if (!card) return;
  if (!session.attemptStarted) return toast("Use target-changing resources only after the first attempt.", "warning");
  const tacticId = card.id === "flex" ? choice : card.id;
  if (card.id === "flex" && !["reroll", "extra-time"].includes(tacticId)) return;
  if (tacticId === "word-swap") {
    if (session.targetChangeUsed) return toast("Only one target change is allowed this turn.", "warning");
    if (!session.bank.length) return toast("No different Word Bank target is available. The swap was not spent.", "warning");
    stopTimer(); session.swapMode = true; session.bankOpen = true; session.pendingSwapId = instanceId; toast("Choose a Word Bank card, or cancel.");
  }
  else if (tacticId === "reroll") {
    if (session.targetChangeUsed) return toast("Only one target change is allowed this turn.", "warning");
    stopTimer();
    queueForLaterReview(session, session.target, "reroll");
    consumeTactic(instanceId, false);
    session.targetChangeUsed = true;
    session.phase = "roll"; session.target = null; session.targetChoices = []; session.reveals = new Set(); session.mission = null;
  }
  else if (tacticId === "extra-time") { stopTimer(); consumeTactic(instanceId, false); turnTimer.add(30); toast("30 seconds added. Timer remains paused.", "success"); }
  persistSession();
  renderGame();
  focusAction(session.phase === "roll" ? '[data-action="roll-d20"]' : '[data-action="toggle-bank"], [data-action="timer-toggle"]');
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

function toggleBank() {
  if (session.config.mode !== "supported" || session.swapMode) return;
  if (!session.attemptStarted && !session.bankOpen) return toast("Record the first attempt before opening choices.", "warning");
  session.bankOpen = !session.bankOpen;
  persistSession();
  renderGame();
  focusAction('[data-action="toggle-bank"]');
}

function toggleTimer() {
  if (session.phase !== "speak") return;
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
  display.textContent = formatTime(session.timer.remaining, session.timer.duration === 0);
  display.classList.toggle("urgent", session.timer.duration > 0 && session.timer.remaining <= 5);
  const button = document.querySelector('[data-action="timer-toggle"]');
  if (button) button.textContent = session.timer.duration === 0 ? "Off" : session.timer.running ? "Pause" : "Start";
}

function formatTime(seconds, off = false) { return off ? "Off" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

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
  const points = session.retryInProgress ? 0 : result === "excellent" ? 2 : result === "success" ? 1 : 0;
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
  toast(session.retryInProgress ? (result === "success" ? "Unscored retry completed successfully." : "Retry passed; the word stays in later review.") : result === "excellent" ? "+2 — detail, reason, or follow-up included." : result === "success" ? "+1 — intended target sense and mission complete." : "Passed. This word is queued for later review.", result === "pass" ? "info" : "success");
  scheduleForCurrentTurn(startTurn, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300);
}

function shouldEndGame() {
  const config = session.config;
  if (config.endType === "manual") return false;
  if (config.endType === "points") return session.players.some((player) => player.score >= config.endTarget);
  return session.players.every((player) => player.turns >= config.endTarget);
}

function skipPlayer() {
  if (!session || session.ended) return;
  stopTimer();
  cancelDelayedCallbacks();
  const player = session.players[session.currentIndex];
  player.turns += 1;
  session.completedTurns += 1;
  if (session.target) queueForLaterReview(session, session.target, "pass-turn");
  persistSession();
  if (shouldEndGame()) return finishGame();
  session.currentIndex = (session.currentIndex + 1) % session.players.length;
  startTurn();
  toast("Turn passed with no score. The next participant is ready.");
}

function supportedRetry() {
  if (session?.phase !== "speak" || !session.target || !session.attemptStarted || session.supportedRetryUsed) return;
  stopTimer();
  cancelDelayedCallbacks();
  session.supportedRetryUsed = true;
  session.helpedThisTurn = true;
  session.retryInProgress = true;
  session.attemptStarted = false;
  session.reveals = new Set();
  queueForLaterReview(session, session.target, "supported-retry");
  const duration = turnDuration();
  session.timer = { duration, remaining: duration, running: false, deadline: null };
  turnTimer.attach(session.timer);
  persistSession();
  renderGame();
  focusAction('[data-action="mark-attempt"]');
  toast("Retry ready. Same speaker and target; help is hidden and this retry is unscored.", "success");
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
  focusAction('[data-action="recall-next"]');
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
  const scores = [...session.players].sort((a, b) => b.score - a.score).map((player, index) => `<li><span>${index + 1}</span><div><strong>${h(player.name)}</strong><small>${player.successful} successful · ${player.excellent} excellent · ${player.turns} turn${player.turns === 1 ? "" : "s"}</small></div><b>${player.score}</b></li>`).join("");
  const difficult = [...session.difficulties.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => session.encountered.get(id)?.word).filter(Boolean);
  app.innerHTML = `<section class="results-view">
    <div class="winner-panel"><span class="result-crest" aria-hidden="true">勝</span><p class="eyebrow">FINAL RESULT</p><h1>${winners.length > 1 ? "It’s a tie!" : `${h(winners[0].name)} wins!`}</h1><p>${winners.map((player) => h(player.name)).join(" & ")} finished with <strong>${maxScore} point${maxScore === 1 ? "" : "s"}</strong>.</p></div>
    <div class="results-grid"><section class="paper-panel final-scores"><h2>Final scores</h2><ol>${scores}</ol></section><section class="paper-panel session-stats"><h2>Session notes</h2><dl><div><dt>Words encountered</dt><dd>${session.encountered.size}</dd></div><div><dt>Successful attempts</dt><dd>${session.players.reduce((sum, player) => sum + player.successful, 0)}</dd></div><div><dt>Excellent responses</dt><dd>${session.players.reduce((sum, player) => sum + player.excellent, 0)}</dd></div><div><dt>Final recall</dt><dd>${session.recall ? `${session.recall.remembered}/${session.recall.words.length}` : "—"}</dd></div></dl>${difficult.length ? `<p><strong>Worth reviewing:</strong> ${difficult.map(h).join(", ")}</p>` : ""}</section></div>
    <div class="result-actions"><button class="primary-button" type="button" data-action="review-words">Quick word review</button><button class="secondary-button" type="button" data-action="undo-score" ${session.history.length ? "" : "disabled"}>Undo final score</button><button class="secondary-button" type="button" data-action="play-again">Play again · same set</button><button class="secondary-button" type="button" data-action="change-set">Change word set</button><button class="text-button" type="button" data-action="home">Home</button></div>
  </section>`;
  focusMain();
}

function renderReview() {
  applyTheme(session.config.level);
  const words = [...session.encountered.values()];
  app.innerHTML = `<section class="review-view"><header class="setup-titlebar"><button class="back-button" type="button" data-action="results" aria-label="Back to results">←</button><div><p class="eyebrow">QUICK REVIEW</p><h1>Words from this game</h1><p>Open only the support students need. Source fields flagged for a sense check stay hidden.</p></div></header><div class="review-list">${words.length ? words.map((word) => `<article class="paper-panel review-word"><header><div><h2>${h(word.word)}</h2><span>(${h(shortPos(word.partOfSpeech))})</span></div>${session.difficulties.has(word.id) ? `<em>TRY AGAIN</em>` : `<em>ENCOUNTERED</em>`}</header><details><summary>日本語</summary><p lang="ja">${h(word.japanese || "Japanese meaning not provided.")}</p></details><details><summary>Meaning</summary><p>${h(helpIsUsable(word, "definition") ? word.englishDefinition : word.quality?.definition === "needs-review" ? "Withheld pending sense review." : "English definition not provided.")}</p></details><details><summary>Example</summary><p>${h(helpIsUsable(word, "example") ? word.example : word.quality?.example === "needs-review" ? "Withheld pending sense review." : "Example sentence not provided.")}</p></details></article>`).join("") : `<p class="paper-panel empty-review">No words were revealed in this game.</p>`}</div><div class="result-actions"><button class="primary-button" type="button" data-action="play-again">Play again</button><button class="secondary-button" type="button" data-action="results">Back to results</button></div></section>`;
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
  if (element.name === "endType") setup.endTarget = setup.endType === "rounds" ? 2 : setup.endType === "points" ? 10 : setup.endTarget;
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

function focusAction(selector) {
  requestAnimationFrame(() => app.querySelector(selector)?.focus({ preventScroll: true }));
}

async function resumeSavedSession() {
  if (session && !session.ended) {
    setup = cloneData(session.config);
  } else if (resumeCandidate) {
    session = resumeCandidate;
    resumeCandidate = null;
    setup = cloneData(session.config);
  } else return;
  if (setup.level !== "Custom") await loadLevel(setup.level);
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
  "choose-level": async (button) => { setup = { ...createInitialSetup(), level: button.dataset.level, customWords: null }; await loadLevel(setup.level); renderSetup(); },
  "set-selection": (button) => { setup.selection = button.dataset.selection; renderSetup(); },
  "set-mode": (button) => { setup.mode = button.dataset.mode; renderSetup(); },
  "start-game": startGame, "roll-d20": rollD20, "reveal-word": revealBookletWord,
  "choose-target": (button) => chooseTarget(button.dataset.wordId),
  "mark-attempt": markAttempt, "reveal-help": (button) => revealHelp(button.dataset.help),
  "use-tactic": (button) => useTactic(button.dataset.instanceId, button.dataset.tacticChoice),
  "bank-word": (button) => swapWithBank(Number(button.dataset.bankIndex)), "cancel-swap": cancelSwap,
  "toggle-bank": toggleBank,
  "timer-toggle": toggleTimer, "timer-reset": resetTimer,
  judge: (button) => judge(button.dataset.result), "supported-retry": supportedRetry, "skip-player": skipPlayer, "undo-score": undoScore,
  "manual-end": finishGame, "review-words": renderReview, results: renderResults,
  "recall-reveal": revealRecall, "recall-next": nextRecall, "skip-recall": renderResults,
  "resume-session": resumeSavedSession, "discard-resume": discardResume,
  "play-again": () => beginSession(session.pool),
  "change-set": () => setup.level === "Custom" ? renderCustom() : renderSetup(),
  "save-custom": () => playCustomFromForm(true), "play-custom": () => playCustomFromForm(false),
  "use-saved-set": (button) => { const set = customSets.find((item) => item.id === button.dataset.setId); if (set) useCustomSet(set); },
  "delete-saved-set": (button) => deleteCustomSet(button.dataset.setId), "save-settings": saveSettings, "close-settings": closeSettings
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
  try {
    const result = action(button);
    if (result && typeof result.then === "function") result.catch((error) => { console.error("Game action failed:", error); toast("That action could not be completed. Check the selected deck and try once more.", "warning"); });
  } catch (error) { console.error("Game action failed:", error); toast("That action could not be completed. Please try once more.", "warning"); }
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
    renderCustomPreview(event.target.value);
  }
});

async function init() {
  try {
    const [indexResponse, missionResponse, tacticResponse] = await Promise.all([fetch("./data/runtime/index.json"), fetch("./data/missions.json"), fetch("./data/tactics.json")]);
    if (!indexResponse.ok) throw new Error(`Vocabulary index request failed (${indexResponse.status}).`);
    runtimeIndex = await indexResponse.json();
    if (!Array.isArray(runtimeIndex.levels) || !runtimeIndex.levels.length) throw new Error("Vocabulary index is invalid.");
    if (!runtimeIndex.levels.every((entry) => entry && Object.prototype.hasOwnProperty.call(levelMeta, entry.level) && typeof entry.file === "string" && Number.isInteger(entry.count))) throw new Error("Vocabulary index entries are invalid.");
    if (!missionResponse.ok || !tacticResponse.ok) throw new Error("Mission or tactic data could not be loaded.");
    const missionPayload = await missionResponse.json();
    const tacticPayload = await tacticResponse.json();
    missions = Array.isArray(missionPayload?.missions) ? missionPayload.missions.filter((mission) => mission && typeof mission.id === "string" && typeof mission.prompt === "string") : [];
    tacticConfig = tacticPayload && Array.isArray(tacticPayload.tactics) ? tacticPayload : { cardsPerPlayer: 0, tactics: [] };
    if (!missions.length) throw new Error("Mission data contains no usable missions.");
    const saved = safeLoad(STORAGE.resume, null);
    const resumeLevel = saved?.appVersion === APP_VERSION && saved?.snapshot?.config?.level;
    const initialLevel = Object.prototype.hasOwnProperty.call(levelMeta, resumeLevel) ? resumeLevel : settings.defaultLevel;
    await loadLevel(initialLevel);
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
