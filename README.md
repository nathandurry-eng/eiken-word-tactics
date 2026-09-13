# EIKEN Word Tactics

EIKEN Word Tactics is an offline-ready classroom speaking game for Japanese students. Its central rhythm is **retrieve → speak → receive help if necessary**: students see the target word first, attempt a communicative mission, and reveal support only when it is needed.

Version: **v1.1.0**

## What is included

- All five vocabulary levels in the supplied master export: EIKEN 4, EIKEN 3, EIKEN Pre-2, EIKEN 2, and EIKEN Pre-1
- Real month/week filtering, monthly mix, and multi-month review ranges
- Supported, Standard, and Challenge play modes
- Animated D20 selection, including direct 1–20 booklet positions
- Optional EIKEN Booklet Mode
- 24 editable communicative missions
- Face-up Word Bank with animated Word Swap replacement
- Eight configurable Tactic types, two random cards per player/team
- Progressive Japanese, English definition, and example help
- 2–8 players or 2–4 teams, scorekeeping, skip, and undo
- Configurable timer, optional final countdown sound, rounds/points/manual endings
- Results, lightweight word review, and session statistics
- Custom pasted word sets saved in `localStorage`
- Installable PWA with cached static data for temporary offline use
- A four-theme physical card-deck visual system built from the supplied Easy, Medium, Hard, and Challenge artwork
- Illustrated Mission Cards and Tactic Cards, with responsive image derivatives for projector, tablet, and phone layouts
- Keyboard focus styling, large touch targets, reduced-motion support, and responsive layouts

## Local development

Requirements: Node.js 20 or newer. There are no third-party runtime dependencies.

```bash
npm start
```

Open `http://127.0.0.1:4173`. The server deliberately disables caching so edits are visible after refresh.

## Installation and checks

No dependency installation is required. Run the automated checks with:

```bash
npm test
npm run build
```

`npm run build` validates the production-ready files already authored in `dist/`. The deployable output directory is `dist`.

## Project structure

```text
dist/
  index.html
  app.js                 # UI, game flow, settings, storage
  game-engine.js         # testable vocabulary/custom-list/D20 logic
  styles.css
  manifest.webmanifest
  sw.js
  icons/
  assets/
    art/                  # responsive Easy/Medium/Hard/Challenge scenery
    cards/                # optimized Mission and Tactic card artwork
    decor/                # paper texture, seal, plaque, and deck emblem
  data/
    vocabulary.json      # authoritative bundled database
    sample-vocabulary.json
    missions.json        # teacher-editable mission cards
    tactics.json         # tactic availability and quantities
scripts/
  build-visual-assets.py  # rebuilds optimized WebP derivatives from the supplied originals
  serve.mjs
  validate-build.mjs
tests/
  game-engine.test.mjs
```

## Updating `vocabulary.json`

Replace [`dist/data/vocabulary.json`](dist/data/vocabulary.json) with the new JSON export, keeping that filename. The loader accepts either a top-level array or an object with a `vocabulary` array. It understands both the requested app fields and the current master-export fields:

| App concept | Accepted export field |
| --- | --- |
| ID | `id` or `entry_id` |
| Japanese | `japanese` or `japanese_meaning` |
| Example | `example` or `example_sentence` |
| Position | `position` or `word_number` |

Every usable row needs only a non-empty `word`. Missing Japanese, definition, or example content produces a friendly “not provided” message rather than stopping the game. Level, month, and week controls are derived from the actual file; list sizes are never assumed.

After replacing the file, run:

```bash
npm test
npm run build
```

Then change the cache name near the top of `dist/sw.js` (for example, from `eiken-word-tactics-v1.1.0` to `eiken-word-tactics-v1.1.1`) so previously installed copies refresh their offline data promptly.

## Editing missions and tactics

- Edit `dist/data/missions.json` to add or revise prompts. Each mission has an `id`, `category`, `title`, `prompt`, optional `starters`, and a `modes` list containing `supported`, `standard`, and/or `challenge`.
- Edit `dist/data/tactics.json` to change quantities or descriptions. Keep the eight tactic IDs unchanged because the game behavior uses them.

## Rebuilding the supplied artwork

The production-ready WebP derivatives are committed under `dist/assets/`, so Cloudflare does not need Python or Pillow. On the original Windows workstation, the artwork can be regenerated from the source PNG files with:

```bash
python scripts/build-visual-assets.py
```

The script preserves the original images and rewrites only the optimized derivatives in `dist/assets/`.

## GitHub repository

The `main` branch is connected to:

`https://github.com/nathandurry-eng/eiken-word-tactics`

To publish a completed update:

```bash
git add .
git commit -m "Describe the update"
git push origin main
```

Do not commit classroom-only custom sets: they stay in the browser’s `localStorage`.

## Cloudflare Pages deployment

In Cloudflare, choose **Workers & Pages → Create → Pages → Connect to Git**, then select the GitHub repository.

Use these exact build settings:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` (repository root) |
| Environment variables | None required |

Cloudflare Pages will rebuild automatically after each push to the production branch. The service worker uses relative URLs, so the same files also work on preview deployments and GitHub Pages-style subpaths.

## Updating the app

1. Edit files under `dist/` or the JSON configuration files.
2. Update `APP_VERSION` near the top of `dist/app.js` and the visible version in `dist/index.html`.
3. Change the cache version in `dist/sw.js`.
4. Run `npm test` and `npm run build`.
5. Commit and push; Cloudflare Pages redeploys automatically.

## PWA and offline notes

The first successful visit installs the service worker and caches the app shell, missions, tactics, and vocabulary database. After that, a temporary network interruption should not stop an active lesson. Browsers control when service-worker updates become active; closing all old tabs and reopening the app is the quickest way to receive a newly deployed version.

## Data and privacy

The app has no login, server database, analytics, paid API, or environment variables. Teacher settings, player names, and saved custom sets remain on the current device in `localStorage`.
