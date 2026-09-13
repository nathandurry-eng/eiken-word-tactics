# Continuation note

Last updated: 2026-09-13

## Current state

Version 1.1.0 is implemented as a dependency-free static PWA in `dist/`. The supplied master vocabulary export is bundled as `dist/data/vocabulary.json` and currently contains 5,460 usable entries across all five available EIKEN levels.

The visual redesign from `C:\Users\natha\Downloads\design prompt.txt` is implemented. Easy, Medium, Hard, and Challenge now use distinct supplied artwork and theme palettes; the Mission, Target, Tactic, Word Bank, score, timer, and results surfaces read as one physical card-game system. Thirty-eight optimized WebP derivatives are committed under `dist/assets/` (about 3.7 MB total). Originals were not changed.

Core game paths implemented: level/month/week/mix/review setup, custom sets, all three support modes, D20 selection, booklet reveal, progressive help, Word Bank, all eight Tactics, timer, team/player scoring, skip, undo, points/round/manual ending, results, review, settings, local storage, manifest, and service-worker caching.

## Resume checklist

1. Read `README.md` for architecture and deployment settings.
2. Run `npm test` and `npm run build`.
3. Run `npm start` and test the actual browser flow at `http://127.0.0.1:4173`.
4. Recheck the full play flow if game logic changes. The v1.1 visual pass was checked at 1920×1080, 1366×768, 1280×800, 1024×768, 768×1024, 430×932, and 390×844 with no horizontal overflow.
5. The GitHub remote is `https://github.com/nathandurry-eng/eiken-word-tactics.git` on `main`. Cloudflare Pages should use `npm run build` and publish `dist`.

## Important files

- `dist/app.js`: UI/game state and all classroom interactions
- `dist/game-engine.js`: pure parsing/filtering/D20 functions with tests
- `dist/styles.css`: complete responsive ukiyo-e-inspired design system
- `dist/assets/`: committed responsive artwork used by the PWA and offline cache
- `dist/data/vocabulary.json`: authoritative supplied data
- `dist/data/missions.json`: editable mission deck
- `dist/data/tactics.json`: editable tactic deck and quantities
- `tests/game-engine.test.mjs`: core automated checks
- `scripts/validate-build.mjs`: production asset/data validation
- `scripts/build-visual-assets.py`: non-destructive source-PNG to WebP derivative pipeline for the original workstation

## Safe next changes

Keep the progressive disclosure principle intact: target word and part of speech first, help second. When updating offline assets, bump the `CACHE` value in `dist/sw.js`. When changing visible versions, keep `package.json`, `dist/index.html`, and `APP_VERSION` in `dist/app.js` aligned. Generated artwork paths are also listed in the service-worker `CORE` cache and in the production validator.
