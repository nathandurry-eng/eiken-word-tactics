import {
  normalizeVocabulary,
  getMonths,
  getWeeks,
  buildVocabularyPool,
  parseCustomWords,
  selectByD20,
  pickDistinct
} from "./game-engine.js";

const APP_VERSION = "1.0.0";
const STORAGE = {
  settings: "eiken-word-tactics:settings:v1",
  customSets: "eiken-word-tactics:custom-sets:v1",
  recentSetup: "eiken-word-tactics:recent-setup:v1"
};
const levelMeta = {
  "EIKEN 4": { label: "FOUNDATION", className: "foundation", note: "Extra support for the Grade 4 deck." },
  "EIKEN 3": { label: "EASY", className: "easy", note: "Build confidence with familiar speaking tasks." },
  "EIKEN Pre-2": { label: "MEDIUM", className: "medium", note: "Balance support with independent retrieval." },
  "EIKEN 2": { label: "HARD", className: "hard", note: "Explain, compare, and persuade with precision." },
  "EIKEN Pre-1": { label: "CHALLENGE", className: "challenge", note: "Sustain demanding opinions and explanations." }
};
const modeMeta = {
  supported: { label: "SUPPORTED", time: 45, bank: 7, note: "Choose from 3 words · sentence starters · easier help" },
  standard: { label: "STANDARD", time: 30, bank: 5, note: "One word · hidden help · 5-card Word Bank" },
  challenge: { label: "CHALLENGE", time: 20, bank: 3, note: "Less time · harder missions · two-word bonus" }
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
let vocabulary = [];
let missions = [];
let tacticConfig = { cardsPerPlayer: 2, tactics: [] };
const savedSettings = safeLoad(STORAGE.settings, {});
let settings = { ...defaults, ...savedSettings, timers: { ...defaults.timers, ...(savedSettings.timers || {}) } };
let customSets = safeLoad(STORAGE.customSets, []);
let setup = createInitialSetup();
let session = null;
let timerInterval = null;

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

function h(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
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
  stopTimer();
  const primary = ["EIKEN 3", "EIKEN Pre-2", "EIKEN 2", "EIKEN Pre-1"];
  const cards = primary.map((level) => levelCard(level)).join("");
  app.innerHTML = `<section class="home-view">
    <header class="setup-header">
      <p class="eyebrow">Classroom speaking game</p>
      <h1>Retrieve it.<br>Say it.</h1>
      <p class="lead">Choose a deck and get students speaking. Meanings stay hidden until help is genuinely needed.</p>
    </header>
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
  return `<button class="level-card ${meta.className} ${compact ? "compact" : ""}" type="button" data-action="choose-level" data-level="${h(level)}" aria-label="Choose ${h(level)}, ${meta.label}">
    <span>${meta.label}</span><strong>${h(level)}</strong><small>${h(meta.note)}</small><em>${count.toLocaleString()} words</em>
  </button>`;
}

function renderSetup() {
  normalizeSetupForLevel();
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
  setup.playerNames = setup.playerNames.map((name, index) => name.trim() || `${setup.playKind === "teams" ? "Team" : "Player"} ${String.fromCharCode(65 + index)}`);
  const pool = buildVocabularyPool(vocabulary, setup);
  if (!pool.length) return toast("No words match this selection. Choose another list.", "warning");
  safeSave(STORAGE.recentSetup, { ...setup, customWords: undefined });
  beginSession(pool);
}

function beginSession(pool) {
  stopTimer();
  const tacticDeck = buildTacticDeck();
  const players = setup.playerNames.slice(0, setup.playerCount).map((name, index) => ({
    id: `player-${index + 1}`, name, score: 0, turns: 0, successful: 0, excellent: 0, words: [],
    tactics: settings.tacticCards ? dealTactics(tacticDeck, tacticConfig.cardsPerPlayer || 2) : []
  }));
  session = {
    config: structuredClone(setup), pool: [...pool], players, currentIndex: 0, bank: [], phase: "roll", mission: null,
    target: null, targetChoices: [], roll: null, reveals: new Set(), recentWordIds: [], recentMissionIds: [],
    encountered: new Map(), difficulties: new Map(), history: [], timer: { duration: settings.timers[setup.mode], remaining: settings.timers[setup.mode], running: false },
    swapMode: false, secondChance: false, bonusWord: null, ended: false
  };
  refillBank();
  startTurn();
}

function buildTacticDeck() {
  return tacticConfig.tactics.flatMap((card) => Array.from({ length: Math.max(0, Number(card.quantity) || 0) }, (_, index) => ({ ...card, instanceId: `${card.id}-${index}-${Math.random()}` })));
}

function dealTactics(deck, count) {
  const hand = [];
  while (deck.length && hand.length < count) {
    const distinct = deck.map((card, index) => ({ card, index })).filter(({ card }) => !hand.some((held) => held.id === card.id));
    const choices = distinct.length ? distinct : deck.map((card, index) => ({ card, index }));
    const choice = choices[Math.floor(Math.random() * choices.length)];
    hand.push(deck.splice(choice.index, 1)[0]);
  }
  return hand;
}

function bankCount() { return settings.wordBankCount || modeMeta[setup.mode].bank; }

function refillBank() {
  const needed = bankCount() - session.bank.length;
  if (needed <= 0) return;
  const excluded = [...session.bank.map((word) => word.id), ...session.recentWordIds, session.target?.id].filter(Boolean);
  session.bank.push(...pickDistinct(session.pool, needed, excluded));
}

function startTurn() {
  stopTimer();
  const available = missions.filter((mission) => mission.modes?.includes(setup.mode) && !session.recentMissionIds.includes(mission.id));
  const candidates = available.length ? available : missions.filter((mission) => mission.modes?.includes(setup.mode));
  session.mission = candidates[Math.floor(Math.random() * candidates.length)] || missions[0];
  session.recentMissionIds = [...session.recentMissionIds.slice(-3), session.mission?.id].filter(Boolean);
  session.phase = "roll";
  session.target = null;
  session.targetChoices = [];
  session.roll = null;
  session.reveals = new Set();
  session.swapMode = false;
  session.secondChance = false;
  session.bonusWord = null;
  session.timer = { duration: settings.timers[setup.mode], remaining: settings.timers[setup.mode], running: false };
  renderGame();
}

function renderGame() {
  const player = session.players[session.currentIndex];
  const level = levelMeta[setup.level] || { className: "easy", label: "CUSTOM" };
  app.innerHTML = `<section class="game-view ${level.className}">
    <header class="turn-banner"><div><span>NOW SPEAKING</span><strong>${h(player.name)}</strong></div><div class="turn-meta"><span>${h(level.label)}</span><b>${h(modeMeta[setup.mode].label)}</b></div></header>
    <div class="game-layout">
      <div class="play-column">${renderMission()}${renderTargetPanel()}${session.phase === "speak" ? renderTimerAndJudge() : ""}</div>
      <aside class="game-sidebar">${renderScoreboard()}${renderTactics(player)}${renderWordBank()}<div class="teacher-controls"><button type="button" data-action="skip-player">Skip player</button><button type="button" data-action="undo-score" ${session.history.length ? "" : "disabled"}>Undo last score</button><button type="button" data-action="manual-end">End game</button></div></aside>
    </div>
  </section>`;
  updateTimerDisplay();
}

function renderMission() {
  const mission = session.mission;
  return `<article class="mission-card paper-panel"><header><span class="card-kicker">MISSION</span><em>${h(mission?.category || "SPEAK")}</em></header><h2>${h(mission?.title || "Use the word")}</h2><p>${h(mission?.prompt || "Use the target word naturally in spoken English.")}</p>${setup.mode === "supported" && mission?.starters?.length ? `<div class="starters"><span>Try starting with</span>${mission.starters.map((starter) => `<q>${h(starter)}</q>`).join("")}</div>` : ""}</article>`;
}

function renderTargetPanel() {
  if (session.phase === "roll") return `<section class="target-stage paper-panel"><p class="eyebrow">TARGET WORD</p><div class="roll-stage"><button class="d20-button" type="button" data-action="roll-d20" aria-label="Roll the twenty-sided die"><span aria-hidden="true">20</span></button><div><h2>Roll for the word</h2><p>The D20 selects from ${session.pool.length.toLocaleString()} eligible words.</p><button class="primary-button" type="button" data-action="roll-d20">Roll D20</button></div></div></section>`;
  if (session.phase === "rolling") return `<section class="target-stage paper-panel" aria-busy="true"><p class="eyebrow">THE D20 IS ROLLING</p><div class="rolling-die" aria-label="Rolling">${Math.floor(Math.random() * 20) + 1}</div></section>`;
  if (session.phase === "booklet") return `<section class="target-stage paper-panel booklet-stage"><p class="eyebrow">USE EIKEN BOOKLET</p><div class="roll-result"><span>ROLL</span><strong>${session.roll}</strong></div><h2>Find word ${session.target.position} in your EIKEN booklet</h2><p>${session.target.position === session.roll ? "The D20 maps directly to this word." : `This larger deck uses D20 lane ${session.roll} to select booklet word ${session.target.position}.`} Give the student a moment to locate it.</p><button class="primary-button" type="button" data-action="reveal-word">Reveal word / continue</button></section>`;
  if (session.phase === "choose") return `<section class="target-stage paper-panel"><p class="eyebrow">CHOOSE ONE TARGET</p><h2>Which word can you use best?</h2><div class="target-choices">${session.targetChoices.map((word) => `<button type="button" data-action="choose-target" data-word-id="${h(word.id)}"><strong>${h(word.word)}</strong><span>(${h(shortPos(word.partOfSpeech))})</span></button>`).join("")}</div></section>`;
  const word = session.target;
  return `<section class="target-stage paper-panel target-reveal"><header><div><p class="eyebrow">TARGET WORD · D20 ${session.roll}</p><h2>${h(word.word)}</h2><span class="part-of-speech">(${h(shortPos(word.partOfSpeech))})</span></div>${setup.mode === "challenge" && session.bonusWord ? `<div class="bonus-word"><span>EXCELLENT BONUS</span><strong>+ ${h(session.bonusWord.word)}</strong><small>Use both words naturally</small></div>` : ""}</header>
    <div class="help-buttons">${helpButton("japanese", "日本語", settings.showJapanese, "japanese-help")}${helpButton("definition", "MEANING", settings.allowDefinition, "definition-help")}${helpButton("example", "EXAMPLE", settings.allowExample, "example-help")}</div>
    <div class="help-reveals">${revealedHelp("japanese", word.japanese, "Japanese meaning not provided.")}${revealedHelp("definition", word.englishDefinition, "English definition not provided.")}${revealedHelp("example", word.example, "Example sentence not provided.")}</div>
    ${session.swapMode ? `<p class="swap-callout">Choose a highlighted card in the Word Bank.</p>` : ""}</section>`;
}

function shortPos(pos) {
  const map = { noun: "n.", verb: "v.", adjective: "adj.", adverb: "adv.", preposition: "prep.", conjunction: "conj." };
  const clean = String(pos || "word").toLowerCase();
  return map[clean] || clean.split(";").map((part) => map[part.trim()] || part.trim()).join(" / ");
}

function helpButton(type, label, allowed, tacticId) {
  if (!allowed) return "";
  const revealed = session.reveals.has(type);
  const player = session.players[session.currentIndex];
  const direct = setup.mode === "supported" || !settings.tacticCards;
  const hasTactic = player.tactics.some((card) => card.id === tacticId);
  const disabled = !revealed && !direct && !hasTactic;
  return `<button type="button" data-action="reveal-help" data-help="${type}" data-tactic="${tacticId}" aria-pressed="${revealed}" ${disabled ? "disabled title=\"A matching Tactic Card is needed\"" : ""}><span>${revealed ? "✓" : "+"}</span>${label}${!direct && !revealed ? `<small>${hasTactic ? "USE TACTIC" : "TACTIC NEEDED"}</small>` : ""}</button>`;
}

function revealedHelp(type, value, fallback) {
  return session.reveals.has(type) ? `<div class="help-item ${type}"><span>${type === "japanese" ? "日本語" : type.toUpperCase()}</span><p lang="${type === "japanese" ? "ja" : "en"}">${h(value || fallback)}</p></div>` : "";
}

function renderTimerAndJudge() {
  return `<section class="turn-controls paper-panel"><div class="timer-block"><span class="timer-label">TURN TIMER</span><strong id="timer-display">${formatTime(session.timer.remaining)}</strong><div class="timer-buttons"><button type="button" data-action="timer-toggle">Start</button><button type="button" data-action="timer-reset">Reset</button></div></div><div class="judge-block"><span>TEACHER JUDGEMENT</span><div><button class="judge try" type="button" data-action="judge" data-result="try">Try again <b>0</b></button><button class="judge success" type="button" data-action="judge" data-result="success">Success <b>+1</b></button><button class="judge excellent" type="button" data-action="judge" data-result="excellent">Excellent <b>+2</b></button></div></div></section>`;
}

function renderScoreboard() {
  return `<section class="scoreboard paper-panel"><header><span>SCORE</span><small>${setup.endType === "manual" ? "Manual finish" : `${setup.endType === "points" ? "First to" : "Rounds"} ${setup.endTarget}`}</small></header><ol>${session.players.map((player, index) => `<li class="${index === session.currentIndex ? "current" : ""}"><span>${h(player.name)}</span><small>${player.turns} turn${player.turns === 1 ? "" : "s"}</small><strong>${player.score}</strong></li>`).join("")}</ol></section>`;
}

function renderTactics(player) {
  if (!settings.tacticCards) return "";
  return `<section class="tactics-panel paper-panel"><header><span>TACTIC HAND</span><small>${player.tactics.length} left</small></header><div class="tactic-list">${player.tactics.length ? player.tactics.map((card) => `<button type="button" data-action="use-tactic" data-instance-id="${h(card.instanceId)}"><b>${h(card.icon)}</b><span><strong>${h(card.name)}</strong><small>${h(card.description)}</small></span></button>`).join("") : `<p class="empty-hand">No Tactics left.</p>`}</div></section>`;
}

function renderWordBank() {
  return `<section class="word-bank paper-panel ${session.swapMode ? "swap-active" : ""}"><header><span>WORD BANK</span><small>${session.swapMode ? "Choose a card" : "Face-up words"}</small></header><div>${session.bank.map((word, index) => `<button type="button" data-action="bank-word" data-bank-index="${index}" ${session.swapMode ? "" : "disabled"}><strong>${h(word.word)}</strong><small>${h(shortPos(word.partOfSpeech))}</small></button>`).join("")}</div></section>`;
}

function rollD20() {
  if (session.phase !== "roll") return;
  session.phase = "rolling";
  renderGame();
  const delay = matchMedia("(prefers-reduced-motion: reduce)").matches ? 80 : 720;
  setTimeout(() => {
    session.roll = Math.floor(Math.random() * 20) + 1;
    const first = selectByD20(session.pool, session.roll, session.recentWordIds);
    session.target = first;
    session.targetChoices = setup.mode === "supported" ? [first, ...pickDistinct(session.pool, 2, [first.id, ...session.recentWordIds])].sort(() => Math.random() - 0.5) : [];
    session.phase = setup.booklet ? "booklet" : setup.mode === "supported" ? "choose" : "speak";
    if (session.phase === "speak") activateTarget(first);
    renderGame();
  }, delay);
}

function revealBookletWord() {
  session.phase = setup.mode === "supported" ? "choose" : "speak";
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
  session.target = word;
  const duplicateBankIndex = session.bank.findIndex((item) => item.id === word.id);
  if (duplicateBankIndex >= 0) {
    session.bank.splice(duplicateBankIndex, 1);
    refillBank();
  }
  session.reveals = new Set();
  session.recentWordIds = [...session.recentWordIds.slice(-7), word.id];
  session.encountered.set(word.id, word);
  session.bonusWord = setup.mode === "challenge" ? session.bank.find((item) => item.id !== word.id) || null : null;
  session.timer = { duration: settings.timers[setup.mode], remaining: settings.timers[setup.mode], running: false };
}

function revealHelp(type, tacticId) {
  if (session.phase !== "speak" || session.reveals.has(type)) return;
  if (setup.mode !== "supported" && settings.tacticCards && !consumeTactic(tacticId, false)) return toast("That help needs the matching Tactic Card.", "warning");
  session.reveals.add(type);
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
  if (card.id === "word-swap") { consumeTactic(instanceId, false); session.swapMode = true; toast("Choose a Word Bank card."); }
  else if (card.id === "teacher-hint") { consumeTactic(instanceId, false); toast("Teacher: give a clue, but do not say the answer.", "success"); }
  else if (card.id === "japanese-help") { if (!settings.showJapanese) return toast("Japanese help is off in Teacher Settings.", "warning"); consumeTactic(instanceId, false); session.reveals.add("japanese"); }
  else if (card.id === "example-help") { if (!settings.allowExample) return toast("Example help is off in Teacher Settings.", "warning"); consumeTactic(instanceId, false); session.reveals.add("example"); }
  else if (card.id === "definition-help") { if (!settings.allowDefinition) return toast("Definition help is off in Teacher Settings.", "warning"); consumeTactic(instanceId, false); session.reveals.add("definition"); }
  else if (card.id === "reroll") { consumeTactic(instanceId, false); session.phase = "roll"; session.target = null; session.targetChoices = []; session.reveals = new Set(); }
  else if (card.id === "extra-time") { consumeTactic(instanceId, false); session.timer.remaining += 15; session.timer.duration += 15; toast("15 seconds added.", "success"); }
  else if (card.id === "second-chance") { consumeTactic(instanceId, false); session.secondChance = true; toast("Second Chance is ready for this response.", "success"); }
  renderGame();
}

function swapWithBank(index) {
  if (!session.swapMode || !session.bank[index]) return;
  const chosen = session.bank[index];
  const replacement = pickDistinct(session.pool, 1, [...session.bank.map((item) => item.id), chosen.id, session.target?.id, ...session.recentWordIds])[0];
  if (replacement) session.bank.splice(index, 1, replacement); else session.bank.splice(index, 1);
  session.swapMode = false;
  activateTarget(chosen);
  refillBank();
  renderGame();
  toast(`${chosen.word} is now the target.`, "success");
}

function toggleTimer() {
  if (session.phase !== "speak") return;
  if (session.timer.running) stopTimer(); else {
    session.timer.running = true;
    timerInterval = setInterval(() => {
      session.timer.remaining = Math.max(0, session.timer.remaining - 1);
      if (session.timer.remaining <= 5 && session.timer.remaining > 0) playTick();
      if (session.timer.remaining === 0) stopTimer();
      updateTimerDisplay();
    }, 1000);
    updateTimerDisplay();
  }
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  if (session?.timer) session.timer.running = false;
  updateTimerDisplay();
}

function resetTimer() {
  stopTimer();
  session.timer.remaining = settings.timers[setup.mode];
  session.timer.duration = settings.timers[setup.mode];
  updateTimerDisplay();
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
  if (!settings.sound) return;
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = session.timer.remaining === 1 ? 720 : 520;
    gain.gain.value = 0.025;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.07);
  } catch { /* Sound is optional. */ }
}

function judge(result) {
  if (session.phase !== "speak" || !session.target) return;
  stopTimer();
  const player = session.players[session.currentIndex];
  const points = result === "excellent" ? 2 : result === "success" ? 1 : 0;
  if (result === "try" && session.secondChance) {
    session.secondChance = false;
    session.difficulties.set(session.target.id, (session.difficulties.get(session.target.id) || 0) + 1);
    toast("Second Chance: keep the same word and try once more.", "success");
    renderGame();
    return;
  }
  session.history.push({ playerIndex: session.currentIndex, points, result, target: session.target, mission: session.mission, roll: session.roll });
  player.score += points;
  player.turns += 1;
  if (result !== "try") {
    player.successful += 1;
    player.words.push(session.target.word);
    if (result === "excellent") player.excellent += 1;
  } else session.difficulties.set(session.target.id, (session.difficulties.get(session.target.id) || 0) + 1);
  if (shouldEndGame()) return finishGame();
  session.currentIndex = (session.currentIndex + 1) % session.players.length;
  toast(result === "excellent" ? "+2 — excellent use!" : result === "success" ? "+1 — success!" : "No point this time. Keep the word for review.", result === "try" ? "info" : "success");
  setTimeout(startTurn, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300);
}

function shouldEndGame() {
  if (setup.endType === "manual") return false;
  if (setup.endType === "points") return session.players.some((player) => player.score >= setup.endTarget);
  return session.players.every((player) => player.turns >= setup.endTarget);
}

function skipPlayer() {
  stopTimer();
  session.currentIndex = (session.currentIndex + 1) % session.players.length;
  startTurn();
  toast("Player skipped.");
}

function undoScore() {
  const action = session.history.pop();
  if (!action) return;
  const player = session.players[action.playerIndex];
  player.score = Math.max(0, player.score - action.points);
  player.turns = Math.max(0, player.turns - 1);
  if (action.result !== "try") {
    player.successful = Math.max(0, player.successful - 1);
    if (action.result === "excellent") player.excellent = Math.max(0, player.excellent - 1);
    player.words.pop();
  }
  session.currentIndex = action.playerIndex;
  session.target = action.target;
  session.mission = action.mission;
  session.roll = action.roll;
  session.phase = "speak";
  session.reveals = new Set();
  session.timer = { duration: settings.timers[setup.mode], remaining: settings.timers[setup.mode], running: false };
  renderGame();
  toast("Last score undone.", "success");
}

function finishGame() {
  stopTimer();
  session.ended = true;
  renderResults();
}

function renderResults() {
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
    <div class="results-grid"><section class="paper-panel final-scores"><h2>Final scores</h2><ol>${scores}</ol></section><section class="paper-panel session-stats"><h2>Session notes</h2><dl><div><dt>Words encountered</dt><dd>${session.encountered.size}</dd></div><div><dt>Successful attempts</dt><dd>${session.players.reduce((sum, player) => sum + player.successful, 0)}</dd></div><div><dt>Excellent responses</dt><dd>${session.players.reduce((sum, player) => sum + player.excellent, 0)}</dd></div><div><dt>Most-used word</dt><dd>${h(mostUsed?.[0] || "—")}</dd></div><div><dt>Unused in this set</dt><dd>${unused}</dd></div></dl>${difficult.length ? `<p><strong>Worth reviewing:</strong> ${difficult.map(h).join(", ")}</p>` : ""}</section></div>
    <div class="result-actions"><button class="primary-button" type="button" data-action="review-words">Quick word review</button><button class="secondary-button" type="button" data-action="play-again">Play again · same set</button><button class="secondary-button" type="button" data-action="change-set">Change word set</button><button class="text-button" type="button" data-action="home">Home</button></div>
  </section>`;
  focusMain();
}

function renderReview() {
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
  if (element.name === "booklet") setup.booklet = element.checked;
  else if (element.name === "playerCount" || element.name === "endTarget") setup[element.name] = Number(element.value);
  else setup[element.name] = element.value;
  if (element.name === "playKind") {
    const max = setup.playKind === "teams" ? 4 : 8;
    setup.playerCount = Math.min(setup.playerCount, max);
  }
  if (["month", "selection", "reviewFrom", "reviewTo", "playKind", "playerCount", "endType"].includes(element.name)) renderSetup();
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function focusMain() { requestAnimationFrame(() => { app.focus({ preventScroll: true }); scrollTo({ top: 0, behavior: "instant" }); }); }

const actions = {
  home: renderHome, settings: openSettings, custom: renderCustom,
  "choose-level": (button) => { setup = { ...createInitialSetup(), level: button.dataset.level, customWords: null }; renderSetup(); },
  "set-selection": (button) => { setup.selection = button.dataset.selection; renderSetup(); },
  "set-mode": (button) => { setup.mode = button.dataset.mode; renderSetup(); },
  "start-game": startGame, "roll-d20": rollD20, "reveal-word": revealBookletWord,
  "choose-target": (button) => chooseTarget(button.dataset.wordId),
  "reveal-help": (button) => revealHelp(button.dataset.help, button.dataset.tactic),
  "use-tactic": (button) => useTactic(button.dataset.instanceId),
  "bank-word": (button) => swapWithBank(Number(button.dataset.bankIndex)),
  "timer-toggle": toggleTimer, "timer-reset": resetTimer,
  judge: (button) => judge(button.dataset.result), "skip-player": skipPlayer, "undo-score": undoScore,
  "manual-end": finishGame, "review-words": renderReview, results: renderResults,
  "play-again": () => beginSession(session.pool),
  "change-set": () => setup.level === "Custom" ? renderCustom() : renderSetup(),
  "save-custom": () => playCustomFromForm(true), "play-custom": () => playCustomFromForm(false),
  "use-saved-set": (button) => { const set = customSets.find((item) => item.id === button.dataset.setId); if (set) useCustomSet(set); },
  "delete-saved-set": (button) => deleteCustomSet(button.dataset.setId), "save-settings": saveSettings
};

document.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  const action = actions[button.dataset.action];
  if (!action) return;
  event.preventDefault();
  try { action(button); } catch (error) { console.error("Game action failed:", error); toast("That action could not be completed. Please try once more.", "warning"); }
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
    const [vocabResponse, missionResponse, tacticResponse] = await Promise.all([fetch("./data/vocabulary.json"), fetch("./data/missions.json"), fetch("./data/tactics.json")]);
    if (!vocabResponse.ok) throw new Error(`Vocabulary request failed (${vocabResponse.status}).`);
    vocabulary = normalizeVocabulary(await vocabResponse.json());
    if (!vocabulary.length) throw new Error("Vocabulary data contains no usable words.");
    if (missionResponse.ok) missions = (await missionResponse.json()).missions || [];
    if (tacticResponse.ok) tacticConfig = await tacticResponse.json();
    if (!missions.length) throw new Error("Mission data contains no usable missions.");
    renderHome();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch((error) => { console.warn("Service worker:", error); toast("Offline setup did not finish. The online game still works.", "warning"); });
  } catch (error) {
    console.error("EIKEN Word Tactics startup:", error);
    app.innerHTML = `<section class="loading-card error-card"><span class="crest" aria-hidden="true">!</span><h1>The word deck could not open.</h1><p>Check that <code>data/vocabulary.json</code>, <code>missions.json</code>, and <code>tactics.json</code> are present and valid, then reload this page.</p><button class="primary-button" type="button" onclick="location.reload()">Try again</button></section>`;
  }
}

document.documentElement.dataset.version = APP_VERSION;
init();
