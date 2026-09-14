# Continuation note

Last updated: 2026-09-15

## Current state

Version 1.2.0 is the audit-driven, dependency-free static PWA in `dist/`. The refactor began from commit `3d5dad67b5bd43f8046e60e991567f9575d73b57`. The supplied 5,460-entry source export remains unchanged at `dist/data/vocabulary.json`; the build generates compact per-level runtime files and applies only the six reviewed priority overrides.

The classroom flow now uses turn IDs and atomic judgement, full-state undo (including after a win), one deadline-derived timer, versioned resume, shuffled-bag selection, later-turn review, and unscored final recall. Help is free after the initial attempt, and every participant gets Word Swap plus Reroll or Extra Time. The mission deck contains 24 reviewed cards with compatibility and safe fallbacks.

## Architecture

- `dist/app.js`: rendering and classroom flow
- `dist/session-engine.js`: turn identity, atomic judgement, snapshots, undo, review scheduling, and resume
- `dist/timer-engine.js`: the single deadline-derived timer
- `dist/mission-engine.js`: mission compatibility, fallbacks, and level scaling
- `dist/game-engine.js`: vocabulary normalization, pool construction, literal-D20 rules, and shuffled bags
- `dist/data/vocabulary-overrides.json`: approved corrections plus the broader editorial queue
- `scripts/build-runtime-vocabulary.mjs`: compact data generator
- `scripts/build-visual-assets.py`: manifest-driven, non-destructive WebP pipeline

## Resume checklist

1. Read `README.md` for the data, artwork, and deployment details.
2. Run `npm test` and `npm run build`.
3. Run `npm start` and test the browser flow at `http://127.0.0.1:4173`.
4. After layout changes, recheck a six-participant game, expanded help, and a long custom word at 1920×1080, 1366×768, 1280×800, 1024×768, 768×1024, 430×932, and 390×844.
5. The GitHub remote is `https://github.com/nathandurry-eng/eiken-word-tactics.git` on `main`; Cloudflare Pages runs `npm run build` and publishes `dist`.

## Known follow-up

- Physically test installation, offline relaunch, focus, and touch targets on the oldest supported Android tablet; desktop browser emulation cannot certify the real device.
- Continue the broader vocabulary editorial queue in `dist/data/vocabulary-overrides.json`; only the six audit-priority corrections are approved in v1.2.

Keep the progressive-disclosure order intact: target first, then mission, then teacher-controlled help after the initial attempt. For a release, keep the versions in `package.json`, `dist/index.html`, `dist/app.js`, and `dist/sw.js` aligned.
