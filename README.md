# Graywood Reader

A self-hosted manga library tracker with an integrated Kotatsu-style reader. Track series across dozens of scanlation sources, get automatic chapter-update scans, read in a full-featured webtoon/manga reader, and manage multiple user profiles â€” all from a single Node + React app backed by SQLite.

## Features

- ðŸ“š **Library tracking** â€” reading status, progress, favorites, flags, notes, ratings
- ðŸ”Ž **Multi-source discovery** â€” MangaDex API v5, AniList, and 1,100+ Kotatsu-parser sources (Madara / MangaThemesia / WPComics / FoolSlide engines)
- ðŸ“– **Integrated reader** â€” webtoon / single-page / double-page / RTL / LTR modes, auto-scroll, tap zones, scan-group selection, margin crop, image filters, per-page preload engine with anti-hotlink proxying
- ðŸ”„ **Auto-update engine** â€” scheduled background scans with rate-spaced live fetches and update logs
- ðŸ§‘â€ðŸ¤â€ðŸ§‘ **Multi-user profiles** â€” host admin + individual users with per-user library isolation
- ðŸ”’ **Security hardening** â€” host-only admin gate, SSRF-guarded proxies, AES-256-GCM PII encryption, scrypt password hashing, rate limiting
- ðŸ’¾ **SQLite storage** â€” `data/manga.db` is the canonical store (legacy `database.json` auto-migrates on first boot and is kept only as a shutdown/export snapshot)
- ðŸ“± **PWA & Desktop** â€” installable web app + Electron desktop shell (`npm run build:exe`)

## Quick Start

**Prerequisites:** Node.js â‰¥ 22.12

```bash
npm install
npm run dev        # server + Vite dev middleware on http://localhost:3000
```

Production:

```bash
npm run build      # frontend (dist/) + server bundle (dist-server/server.cjs)
npm run start      # node dist-server/server.cjs â€” serves dist/ + API
```

### Environment variables

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Purpose |
|---|---|
| `PORT` / `HOST` | Bind address (default `3000` / `0.0.0.0`). Prefer `127.0.0.1` for single-user. |
| `ENCRYPTION_SECRET` | â‰¥32-char secret for PII encryption + auth tokens. **Required for Docker Compose.** If unset locally, the server manages `data/.encryption-secret`. |
| `REQUIRE_AUTH` | Set to `1` to require login for non-localhost clients (host always allowed). |
| `GEMINI_API_KEY` | Optional â€” AI search & recommendations |
| `STORAGE_PATH` | Optional â€” CBZ/offline storage folder |

## Deployment

- **Docker:** set `ENCRYPTION_SECRET`, then `npm run docker:build && npm run docker:run` (data persists in `./data`). Image runs `node dist-server/server.cjs` (no `tsx`).
- **PM2:** `npm run build && npm run pm2:start` (uses `dist-server/server.cjs`)
- **Linux script:** `npm run deploy:linux` Â· **Windows script:** `npm run deploy:windows`
- **Desktop installer:** `npm run build:exe` (NSIS + portable via electron-builder)

## Architecture

```
server.ts          Express 5 API + source scrapers + auto-updater (~66 endpoints)
sqlite-db.ts       better-sqlite3 data access layer (manga/profiles/settings/logs)
dist-server/       Production server bundle (esbuild CJS)
src/               React 19 + Vite + Tailwind 4 frontend
data/manga.db      Canonical SQLite database (git-ignored)
kotatsu-parsers/   Vendored Kotlin parser repo scanned at boot for source definitions
```

Notes:

- Host-only endpoints (admin, global settings, backups, bulk sync, DB import/export/reset) are restricted by socket IP. Behind a reverse proxy, set Express `trust proxy` appropriately.
- Remote clients can enable token auth via `REQUIRE_AUTH=1` (`POST /api/auth/login` / `register`).
- The image proxy and crawler enforce SSRF protection (private/loopback/link-local/metadata targets are blocked).

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Dev server (tsx + Vite middleware, HMR) |
| `npm run build` | Production frontend + server bundle |
| `npm run build:server` | Server bundle only â†’ `dist-server/server.cjs` |
| `npm run start` | Production server (`node dist-server/server.cjs`) |
| `npm run lint` | TypeScript type check (`tsc --noEmit`) |
| `npm run reader:smoke` | Live Asura/Manhwa18 reader smoke checks |
| `npm run build:exe` | Windows desktop installer |

## Known Issues

See `BUGS.md` — it is the single source of truth for open bugs. Asura/Manhwa18 reading reliability and analytics wiring were improved in the latest maintenance pass; re-verify live extraction after upgrading.

## License

**Graywood Reader** is free software, released under the **GNU General Public
License v3.0-or-later** (`GPL-3.0-or-later`). You may redistribute it and/or
modify it freely, provided you preserve this license and the copyright notices.
See [`LICENSE`](LICENSE) for the full text.

This project builds upon and vendors several third-party projects. Their
licenses and copyright notices are documented in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) and [`NOTICE`](NOTICE):

- **kotatsu-parsers** (vendored) â€” GPL-3.0
- **Mihon** (`source-api` abstractions) â€” Apache-2.0
- **Suwayomi-Server** (reference) â€” MPL-2.0
- **Kotatsu syncserver** (reference) â€” GPL-3.0
- **Jellyfin / jellyfin-web** (reference only, not used) â€” GPL-2.0
- **npm dependencies** â€” see `package.json` and the generated npm license report
