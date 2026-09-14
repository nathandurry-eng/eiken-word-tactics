# EIKEN Word Tactics

EIKEN Word Tactics is an offline-ready classroom speaking game for Japanese students. Its central rhythm is **retrieve → speak → receive help if necessary**: students see the target word first, attempt a communicative mission, and reveal support only when it is needed.

Version: **v1.2.0**

## What is included

- All five vocabulary levels in the supplied master export: EIKEN 4, EIKEN 3, EIKEN Pre-2, EIKEN 2, and EIKEN Pre-1
- Real month/week filtering, monthly mix, and multi-month review ranges
- Supported, Standard, and Challenge play modes
- Shuffled-bag selection for fair full-pool coverage; literal D20 mapping only for exact 20-word lists
- Optional EIKEN Booklet Mode
- 24 editable communicative missions
- A safe face-up Word Swap plus a guaranteed Reroll or Extra Time tactic for every participant
- Free Japanese, English definition, and example help after the initial attempt, followed by one unscored supported retry
- 2–8 players or 2–4 teams, atomic 0/1/2 judgement, skip, and full-state undo (including after a win)
- One deadline-based timer, visibility pause, optional countdown sound, rounds/points/manual endings
- Versioned lesson resume, later-turn review queue, final recall, results, word review, and session statistics
- Custom pasted word sets saved in `localStorage`
- Installable PWA with a validated offline shell and updates activated between lessons
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
  session-engine.js      # atomic turns, undo snapshots, resume, review queue
  timer-engine.js        # single deadline-derived timer
  mission-engine.js      # compatibility, fallbacks, and level scaling
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
    vocabulary-overrides.json # six reviewed, auditable priority corrections
    runtime/             # generated compact per-level data with quality flags
    missions.json        # teacher-editable mission cards
    tactics.json         # tactic availability and quantities
scripts/
  build-runtime-vocabulary.mjs
  build-visual-assets.py  # manifest-driven WebP derivative builder
  visual-assets.manifest.example.json
  serve.mjs
  validate-build.mjs
tests/
  game-engine.test.mjs
  mission-engine.test.mjs
  session-engine.test.mjs
  timer-engine.test.mjs
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

The authoritative source file stays unchanged. The build applies only the reviewed entries in `vocabulary-overrides.json`, generates compact per-level files under `dist/data/runtime/`, and records quality flags for future editorial work. After replacing the source file, run:

```bash
npm test
npm run build
```

Then increment the matching app and service-worker versions so installed copies receive the new runtime data between lessons.

## Editing missions and tactics

- Edit `dist/data/missions.json` to revise the 24 reviewed prompts. Keep their compatibility, mode, level, and fallback metadata valid; the build checks key corrections.
- Edit `dist/data/tactics.json` only for Word Swap, Reroll, and Extra Time. Every participant receives Word Swap plus one of the two flexible tactics.

## Rebuilding the supplied artwork

The production-ready WebP derivatives are committed under `dist/assets/`, so Cloudflare does not need Python or Pillow. On the original Windows workstation, the artwork can be regenerated from the source PNG files with:

Copy `scripts/visual-assets.manifest.example.json`, point it at the untracked source artwork (or pass `--source-dir` for relative paths), then run:

```bash
python scripts/build-visual-assets.py --manifest path/to/visual-assets.local.json
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

The first successful visit installs the service worker and caches the essential app shell, missions, tactics, and compact vocabulary data. Optional artwork failures do not block installation. A temporary network interruption should not stop an active lesson, and waiting updates activate automatically once no lesson is in progress.

## Data and privacy

The app has no login, server database, analytics, paid API, or environment variables. Teacher settings, player names, and saved custom sets remain on the current device in `localStorage`.
