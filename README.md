# OmniManga — Manga, Manhwa & Manhua Tracker & Reader

A self-hosted manga library tracker with an integrated Kotatsu-style reader. Track series across dozens of scanlation sources, get automatic chapter-update scans, read in a full-featured webtoon/manga reader, and manage multiple user profiles — all from a single Node + React app backed by SQLite.

## Features

- 📚 **Library tracking** — reading status, progress, favorites, flags, notes, ratings
- 🔎 **Multi-source discovery** — MangaDex API v5, AniList, and 1,100+ Kotatsu-parser sources (Madara / MangaThemesia / WPComics / FoolSlide engines)
- 📖 **Integrated reader** — webtoon / single-page / double-page / RTL / LTR modes, auto-scroll, tap zones, scan-group selection, margin crop, image filters, per-page preload engine with anti-hotlink proxying
- 🔄 **Auto-update engine** — scheduled background scans with rate-spaced live fetches and update logs
- 🧑‍🤝‍🧑 **Multi-user profiles** — host admin + individual users with per-user library isolation
- 🔒 **Security hardening** — host-only admin gate, SSRF-guarded proxies, AES-256-GCM PII encryption, scrypt password hashing, rate limiting
- 💾 **SQLite storage** — `data/manga.db` is the canonical store (legacy `database.json` auto-migrates on first boot and is kept only as a shutdown/export snapshot)
- 📱 **PWA & Desktop** — installable web app + Electron desktop shell (`npm run build:exe`)

## Quick Start

**Prerequisites:** Node.js ≥ 22.12

```bash
npm install
npm run dev        # server + Vite dev middleware on http://localhost:3000
```

Production:

```bash
npm run build      # build the frontend into dist/
npm run start      # serves dist/ + API
```

### Environment variables

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Purpose |
|---|---|
| `PORT` / `HOST` | Bind address (default `3000` / `0.0.0.0`) |
| `ENCRYPTION_SECRET` | ≥32-char secret for PII encryption. If unset, the server manages its own key in `data/.encryption-secret` |
| `GEMINI_API_KEY` | Optional — AI search & recommendations |
| `STORAGE_PATH` | Optional — CBZ/offline storage folder |

## Deployment

- **Docker:** `npm run docker:build && npm run docker:run` (data persists in `./data`)
- **PM2:** `npm run pm2:start`
- **Linux script:** `npm run deploy:linux` · **Windows script:** `npm run deploy:windows`
- **Desktop installer:** `npm run build:exe` (NSIS + portable via electron-builder)

## Architecture

```
server.ts          Express 5 API + source scrapers + auto-updater (~66 endpoints)
sqlite-db.ts       better-sqlite3 data access layer (manga/profiles/settings/logs)
src/               React 19 + Vite + Tailwind 4 frontend
data/manga.db      Canonical SQLite database (git-ignored)
kotatsu-parsers/   Vendored Kotlin parser repo scanned at boot for source definitions
```

Notes:

- Host-only endpoints (admin, global settings, backups, bulk sync) are restricted by socket IP. Behind a reverse proxy, set Express `trust proxy` appropriately.
- The image proxy and crawler enforce SSRF protection (private/loopback/link-local/metadata targets are blocked).

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Dev server (tsx + Vite middleware, HMR) |
| `npm run build` | Production frontend build |
| `npm run start` | Production server |
| `npm run lint` | TypeScript type check (`tsc --noEmit`) |
| `npm run build:exe` | Windows desktop installer |

## Known Issues

See `BUGS.md` — it is the single source of truth for open bugs (currently none active).