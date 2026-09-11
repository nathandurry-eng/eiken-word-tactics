# Continuation note

Last updated: 2026-09-11

## Current state

Version 1.0.0 is implemented as a dependency-free static PWA in `dist/`. The supplied master vocabulary export is bundled as `dist/data/vocabulary.json` and currently contains 5,460 usable entries across all five available EIKEN levels.

Core game paths implemented: level/month/week/mix/review setup, custom sets, all three support modes, D20 selection, booklet reveal, progressive help, Word Bank, all eight Tactics, timer, team/player scoring, skip, undo, points/round/manual ending, results, review, settings, local storage, manifest, and service-worker caching.

## Resume checklist

1. Read `README.md` for architecture and deployment settings.
2. Run `npm test` and `npm run build`.
3. Run `npm start` and test the actual browser flow at `http://127.0.0.1:4173`.
4. Check phone (390×844), tablet landscape (1024×768), and desktop (1440×900) layouts.
5. The local Git repository has no GitHub remote. The linked GitHub connector did not find an installed `eiken-word-tactics` repository. A GitHub repository must be created/connected before push or PR work.

## Important files

- `dist/app.js`: UI/game state and all classroom interactions
- `dist/game-engine.js`: pure parsing/filtering/D20 functions with tests
- `dist/styles.css`: complete responsive ukiyo-e-inspired design system
- `dist/data/vocabulary.json`: authoritative supplied data
- `dist/data/missions.json`: editable mission deck
- `dist/data/tactics.json`: editable tactic deck and quantities
- `tests/game-engine.test.mjs`: core automated checks
- `scripts/validate-build.mjs`: production asset/data validation

## Safe next changes

Keep the progressive disclosure principle intact: target word and part of speech first, help second. When updating offline assets, bump the `CACHE` value in `dist/sw.js`. When changing visible versions, keep `package.json`, `dist/index.html`, and `APP_VERSION` in `dist/app.js` aligned.

