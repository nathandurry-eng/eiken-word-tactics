# Continuation note

Last updated: 2026-09-15

## Current state

Version 1.3.1 is the fully cross-referenced audit release of the dependency-free static PWA in `dist/`. The refactor began from commit `3d5dad67b5bd43f8046e60e991567f9575d73b57`. The supplied 5,460-entry source export remains unchanged at `dist/data/vocabulary.json`; the build generates compact per-level runtime files, exposes source coverage, applies only the six reviewed priority overrides, and suppresses unreviewed help for the 721 sense-flagged records.

The classroom flow uses turn IDs and atomic scoring, full-state score undo (including after a win), one deadline-derived timer with level defaults/off, versioned resume, shuffled-bag selection, later-turn review, and unscored final recall. Help follows attempt → short cue → retry → model example, with the model hidden for the retry. Every participant gets Word Swap plus one choose-on-use Flex Card. The 24-card mission deck includes compatibility, safe fallbacks, level scaling, and an explicit next-listener role.

## Architecture

- `dist/app.js`: rendering and classroom flow
- `dist/session-engine.js`: turn identity, atomic judgement, snapshots, undo, review scheduling, and resume
- `dist/timer-engine.js`: the single deadline-derived timer
- `dist/mission-engine.js`: mission compatibility, fallbacks, and level scaling
- `dist/game-engine.js`: vocabulary normalization, pool construction, literal-D20 rules, and shuffled bags
- `dist/data/vocabulary-overrides.json`: approved corrections plus the broader editorial queue
- `scripts/build-runtime-vocabulary.mjs`: compact data generator
- `scripts/build-visual-assets.py`: manifest-driven, non-destructive WebP pipeline
- `AUDIT-COMPLIANCE.md`: permanent A–O requirement/evidence matrix

## Resume checklist

1. Read `README.md` for the data, artwork, and deployment details.
2. Run `npm test` and `npm run build`.
3. Run `npm start` and test the browser flow at `http://127.0.0.1:4173`.
4. After layout changes, recheck a six-participant game, expanded help, and a long custom word at 1920×1080, 1366×768, 1280×800, 1024×768, 768×1024, 430×932, and 390×844.
5. The GitHub remote is `https://github.com/nathandurry-eng/eiken-word-tactics.git` on `main`; Cloudflare Pages runs `npm run build` and publishes `dist`.

## Known follow-up

- Physically test installation, offline relaunch, focus, and touch targets on the oldest supported Android tablet; desktop browser emulation cannot certify the real device.
- Continue the broader vocabulary editorial queue in `dist/data/vocabulary-overrides.json`; only the six audit-priority corrections are approved in v1.3.
- Conduct the audit’s real teacher/student comprehension and timing trials; automated checks cannot substitute for classroom participants.

Keep the progressive-disclosure order intact: target first, then mission, then teacher-controlled help after the initial attempt. For a release, keep the versions in `package.json`, `dist/index.html`, `dist/app.js`, and `dist/sw.js` aligned.
