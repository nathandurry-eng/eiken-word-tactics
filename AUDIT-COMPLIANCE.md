# EIKEN Word Tactics audit compliance

Last verified: 2026-09-15  
Release: v1.3.1  
Audit source: `C:\Users\natha\Downloads\EIKEN_Word_Tactics_System_Audit.docx`

This file maps the full audit to the released implementation. “Implemented” means the requirement is present in the repository and covered by automated or browser evidence. “External validation” means the implementation work is complete but the audit explicitly requires a real device or real classroom participants; those claims cannot be certified by software tests.

## Executive cross-reference

| Audit section | Status | Implementation and evidence |
| --- | --- | --- |
| A. Executive verdict | Implemented, with two external release gates | The dependency-free static PWA retains the useful physical-game identity while correcting the pedagogical, state, fairness, performance, and PWA defects. Physical old-tablet and classroom trials remain external validation. |
| B. What is already working | Preserved | Five levels, month/week pools, modes, booklet option, visual themes, custom sets, scoring, timer, local persistence, and offline installation remain. The original 5,460-entry source database is byte-identical. |
| C. Top 10 problems | Implemented | All ten code/content/UX issues are closed individually in the next table. |
| D. Pedagogy audit | Implemented; classroom timing/comprehension trial external | Target-first retrieval, delayed help, cue-before-example, an unscored same-word retry, later-turn retrieval, final recall, level routes, and listener follow-ups are implemented. |
| E. Game design audit | Implemented | Equal rounds are the default; race mode is explicitly unequal-turn. Word Bank size is fixed at 3/3/2, Supported hides it until needed, every participant receives Word Swap plus one choose-on-use Flex Card, and target selection uses a shuffled bag. |
| F. Content / missions / tactics audit | Implemented, with ongoing editorial queue visible | All 24 missions were rewritten and routed by mode/level/POS compatibility. Paid-help tactics were removed. Six approved vocabulary overrides are auditable; 721 sense-flagged entries withhold unsafe definition/example help until reviewed. Source coverage is reported as 156 populated of 180 expected sets. |
| G. Visual + graphics audit | Implemented | Supplied Easy/Medium/Hard/Challenge art is used as responsive, non-destructive scenery; card art and deck covers are preserved; the target and teaching controls remain readable above decorative imagery. |
| H. UX / classroom flow audit | Implemented | Setup gives an exact pool/finish summary and compact teacher rule. The active speaker, listener role, target, timer, support state, single outcome, pass, and undo are explicit. Results report turns and recall without misleading “most used” or “unused” claims. |
| I. Responsive / device audit | Implemented in code and browser; oldest physical tablet external | CSS includes tablet/phone layouts, long-word handling, 44 px mobile targets, focus styling, reduced motion, screen-reader status, dialog/aspect-ratio fallbacks, and JSON clone fallback. A real oldest-supported Android tablet must still be checked. |
| J. Technical code audit | Implemented | Turn IDs and atomic judgement prevent double scoring. Undo restores full turn state, including a just-finished game. One deadline-derived timer owns all clock state. Resume data is versioned, bounded, shape-validated, and level-lazy-loaded. |
| K. Performance / PWA / Cloudflare audit | Implemented | Startup loads the small index and selected level only. The service worker separates essential/optional assets, survives optional-art failures, rejects interrupted essential installs, caches only allowlisted selected decks, returns correct offline fallbacks, and activates updates between lessons. GitHub CI runs tests and the production validator. |
| L. Features to remove | Implemented | Random essential support, paid meaning/help cards, misleading D20 claims for larger pools, cropped-in-UI card compositions, premature model examples, and unsupported results statistics are removed. |
| M. Missing features worth adding | Implemented | Level scaling, explicit listeners, supported retry, final recall, later-turn review, exact booklet location, word-quality suppression, source-coverage messaging, custom import preview, pass-turn accounting, safe resume, and update handling are present. |
| N. Prioritized fix roadmap | Implemented in release scope | Phases 1–4 are represented by the state-engine refactor, mission/content revision, responsive art/layout work, and release hardening/tests. External gates are recorded rather than falsely marked complete. |
| O. Codex implementation brief | Implemented | The repository follows the paste-ready brief: authoritative data preserved, progressive disclosure retained, required missions/tactics implemented, PWA hardened, checks reproducible, and continuation instructions kept in `CONTINUATION.md`. |

## Closure of the top 10 problems

| # | Audit problem | Closure |
| --- | --- | --- |
| 1 | Some help teaches the wrong meaning | Applied only six approved entry-ID overrides; marked all 721 “Meaning match needs review” records and suppresses unsafe definition/example help until approved. |
| 2 | Essential support depends on a random hand | Every participant always receives Word Swap plus one Flex Card that becomes Reroll or Extra Time at use time. Core teacher help is free and separate from tactics. |
| 3 | “Try again” usually means end the turn | Supported Retry keeps the same speaker and word, resets the paused timer, hides revealed help, records a fresh attempt, and awards zero points. |
| 4 | Scoring and recovery are not atomic | `turnId`, `claimTurnOutcome`, `judgedTurnIds`, full-state snapshots, and undo-after-win tests make outcomes single-claim and recoverable. |
| 5 | Timer transitions can leave multiple clocks running | `TurnTimer` uses one deadline and one scheduled tick; visibility, add/reset, retry, turn change, results, and resume transitions are tested. |
| 6 | Missions are not matched to level or target | The 24-card version-3 deck includes category, mode, level, compatibility, fallback, listener, and level-route metadata. |
| 7 | Target and support layout fails classroom priorities | Target appears before mission; meanings remain hidden; Supported choices and the bank are progressively disclosed; the speaking/listener/status order is explicit. |
| 8 | Artwork has been cropped into the wrong composition | Source PNGs remain outside production; manifest-driven WebP derivatives preserve landscape/card roles and use responsive object positioning rather than destructive source edits. |
| 9 | D20 mapping is biased and booklet location incomplete | Exact 20-word pools map literally. Every larger pool uses Fisher–Yates shuffled-bag coverage; booklet mode shows level, month, week, and source entry. |
| 10 | Review records exposure without ensuring retrieval | Help/reroll/pass targets enter a review queue eligible after later turns; the session ends with an unscored Japanese-to-English recall. |

## Reproducible verification

- `npm test`: unit coverage for vocabulary/custom parsing, shuffled selection, mission routing, timer ownership, atomic scoring/undo/resume, service-worker failure modes, and the release contract.
- `npm run build`: regenerates five compact level decks, then validates 5,460 unique runtime entries, all five levels, 156/180 source-set coverage, six override integrity checks, the 721-entry suppression queue, 24 missions, three retained tactics, install icons, version alignment, CI, and the selected-level offline contract.
- Source SHA-256: `9b1437e3815010691f5c57c29bcd6ae9398a438d43fc22b9ed10cf8995614712`.
- Browser configuration A: EIKEN 3 / Supported / 3 individuals / September Week 1 / 1 equal round. Verified staged help, bank unlock, unscored retry, turn accounting, final recall, and results.
- Browser configuration B: EIKEN Pre-2 / Standard / 2 teams / September Week 1 / 2 equal rounds. Verified 40-second floor, team listener, four equal turns, recall, and results.
- Browser configuration C: EIKEN 2 / Standard / 4 individuals / September Mix / 1 equal round. Verified 117-word pool, 45-second floor, listener follow-up, four equal turns, recall, and results.
- Browser configuration D: EIKEN Pre-1 / Challenge / 2 individuals / July–September review / 2 equal rounds / booklet on. Verified 405-word pool, two-card bank, 60-second floor, level route, optional two-word stretch, exact booklet location, four equal turns, and results.
- Responsive browser matrix: 1920×1080, 1366×768, 1280×800, 1024×768, 768×1024, 430×932, and 390×844. At every size, home, custom preview, six-player setup, six-player game, and expanded-help/long-word states had no horizontal overflow, clipped controls, or console errors; primary phone controls measured at least 44 px.
- Offline browser relaunch: after caching the selected EIKEN 3 deck, a network-disabled 390×844 reload remained service-worker controlled, rendered v1.3.1 with all five deck choices, produced no console errors, and had no horizontal overflow.

## External validation still required

These are the only audit items not honestly certifiable inside the repository:

1. Install and relaunch offline on the oldest supported physical Android tablet; check touch targets, focus, audio policy, memory pressure, and browser-specific PWA behavior.
2. Run the planned teacher/student comprehension and timing sessions with real participants, then record whether mission wording, cue timing, and Pre-1 response length need adjustment.

The broader vocabulary editorial queue also remains ongoing content work. Unsafe help is already withheld, so it is a controlled improvement queue rather than an unmitigated classroom defect.
