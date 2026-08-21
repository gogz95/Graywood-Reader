# Graywood Reader

> ⚡ **Note on Development**: This project is proudly **vibecoded** with AI assistance and is **heavily inspired by other incredible open-source apps** across the manga/manhwa reading ecosystem — including **Kotatsu**, **Tachiyomi / Mihon**, **Suwayomi**, **Paperback**, and **Komga**.

A modern, high-performance self-hosted manga, manhwa, and manhua library tracker with a feature-rich Kotatsu-inspired reader. Track your collection across hundreds of scanlation sources, enjoy seamless webtoon and double-page book reading, automatic chapter updates, offline downloads, AniList progress scrobbling, and an OPDS catalog server — all from a single lightweight Node + React application backed by SQLite.

---

## ✨ Features

- 📚 **Smart Library Management** — Track reading statuses (`reading`, `completed`, `plan_to_read`, `on_hold`, `dropped`), unread chapter counters, favorites, flags, personal ratings, and custom tags.
- 🗂️ **Multi-Select Bulk Actions** — Floating toolbar for batch status changes, bulk mark-as-read, and mass deletion.
- 🔍 **Multi-Source Discovery** — MangaDex API v5, AniList search, and 1,100+ Kotatsu-parser sources (Madara, MangaThemesia, WPComics, FoolSlide, and custom HTML engines).
- 📖 **Kotatsu-Inspired Reader**:
  - **Layouts**: Webtoon (Seamless 0px gap & Standard), Japanese Manga Right-to-Left (RTL), Left-to-Right (LTR), Single Page, and Double-Page Book Spread.
  - **Smart Guided Panel View**: Snap-to-panel keyboard/tap scrolling for long-strip webtoons.
  - **Visual Shader Filters**: Normal, Line-Art Sharpener, E-Ink (e-paper high-contrast mode), OLED Ultra-Dark, Warm Sepia, Grayscale, and High-Contrast.
  - **Private Page Sticky Notes**: Pin personal notes, impressions, and theories directly to specific pages with instant jump-to-page navigation.
  - **Instant Next Chapter Prefetch**: 0ms chapter transitions via silent background prefetching.
  - **Granular Auto-Scroll**: 60 FPS smooth micro-stepping with countdown auto-progression.
- 💾 **100% Offline Reading** — Download complete chapters into browser `IndexedDB` storage for instant zero-network offline reading.
- 🛡️ **Automated Bot Defense Bypass** — Multi-tiered Cloudflare Turnstile, DDoS check, and Captcha solver pipeline (FlareSolverr + 2Captcha/CapSolver integration).
- 🔄 **Ecosystem Sync & Portability**:
  - **Tachiyomi / Mihon JSON Backups**: Full bidirectional import and export support.
  - **AniList GraphQL Live Scrobbler**: Automatically updates your AniList reading progress as chapters are completed.
  - **OPDS 1.2 Catalog Server**: Serve your collection to e-readers (KOReader, Moon+ Reader, Panels, Paperback) via `/api/opds/catalog.xml`.
- ⚡ **High-Performance SQLite Backend** — WAL mode enabled with parameterized queries, sub-millisecond writes, and immutable image proxy caching with HTTP 304 ETags.
- 📱 **Progressive Web App (PWA) & Desktop** — Standalone PWA installable on iOS/Android, plus an Electron desktop shell.

---

## 🚀 Quick Start

**Prerequisites:** Node.js ≥ 22.12

```bash
# 1. Install dependencies
npm install

# 2. Run local development server
npm run dev        # API server + Vite HMR on http://localhost:3000
```

### Production Build & Run

```bash
# Build frontend bundle (dist/) + backend bundle (dist-server/server.cjs)
npm run build

# Start production server
npm run start      # node dist-server/server.cjs
```

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Purpose |
|---|---|
| `PORT` / `HOST` | Bind address (default `3000` / `0.0.0.0`). Prefer `127.0.0.1` for single-user desktop setups. |
| `ENCRYPTION_SECRET` | ≥32-character secret for PII encryption and auth tokens. **Required for Docker Compose.** |
| `REQUIRE_AUTH` | Set to `1` to enforce multi-user authentication for non-localhost connections. |
| `GEMINI_API_KEY` | Optional — AI-powered series search, smart tagging, and recommendations. |
| `STORAGE_PATH` | Optional — Offline/CBZ storage folder. |

---

## 🐳 Deployment

- **Docker Compose:**
  ```bash
  npm run docker:build
  npm run docker:run
  ```
  *(Data persists in `./data/manga.db`)*
- **PM2 Process Manager:** `npm run build && npm run pm2:start`
- **Linux Deployment Script:** `npm run deploy:linux`
- **Windows Deployment Script:** `npm run deploy:windows`
- **Desktop Electron Installer:** `npm run build:exe` (Generates standalone NSIS installer)

---

## 🏗️ Architecture

```
Graywood-Reader/
├── server.ts                    # Express 5 API + OPDS 1.2 server + scrapers + auto-updater
├── sqlite-db.ts                 # better-sqlite3 DAL (manga, profiles, reading progress, notes)
├── server/
│   ├── captchaSolver.ts         # Cloudflare Turnstile & 2Captcha solver orchestrator
│   └── security.ts              # AES-256-GCM PII encryption, SSRF filters & token auth
├── src/
│   ├── App.tsx                  # Root application controller & lazy module router
│   ├── components/
│   │   ├── ReaderView.tsx       # Kotatsu-inspired reader (Webtoon, Double spread, E-Ink, Notes)
│   │   ├── LibraryView.tsx      # Multi-select library grid/table with virtualized chunking
│   │   ├── SettingsModal.tsx    # Preferences, FlareSolverr, AniList, and Tachiyomi backups
│   │   └── ...                  # Browse, Sources, Analytics, Duplicates modals
│   └── utils/
│       ├── readingMode.ts       # Format detection & persistent reader settings
│       ├── offlineStorage.ts    # IndexedDB offline chapter cache engine
│       ├── tachiyomiImporter.ts # Tachiyomi v2 / Mihon JSON backup parser & exporter
│       └── aniListScrobbler.ts  # AniList GraphQL live scrobbler
├── public/
│   ├── manifest.webmanifest     # Standalone PWA web manifest
│   └── sw.js                    # Service Worker static asset caching
└── kotatsu-parsers/             # Vendored Kotlin scraper definitions scanned on startup
```

---

## 📜 NPM Scripts

| Script | Description |
|---|---|
| `npm run dev` | Starts server + Vite HMR development server |
| `npm run build` | Full production build (`vite build` + `esbuild server.ts`) |
| `npm run build:server` | Bundles server only into `dist-server/server.cjs` |
| `npm run start` | Runs production server (`node dist-server/server.cjs`) |
| `npm run lint` | Runs TypeScript type checking (`tsc --noEmit`) |
| `npm run reader:smoke` | Executes live source reader smoke tests |
| `npm run build:exe` | Generates Windows desktop executable |

---

## 🐛 Bug Tracker & Roadmap

- **Known Issues & Bug Fixes**: See [`BUGS.md`](BUGS.md) for the active bug tracker and historical archive.
- **Future Feature Roadmap**: See [`ROADMAP.md`](ROADMAP.md) for planned gamification features, ambient atmosphere sound engine, and cloud integrations.

---

## 🤝 Contributing & Community

Contributions are what make the open-source community an amazing place to learn, inspire, and create.
- **Contributing Guidelines**: See [`CONTRIBUTING.md`](CONTRIBUTING.md) for local setup, development commands, and architecture details.
- **Code of Conduct**: See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for community guidelines.
- **Security Policy**: See [`SECURITY.md`](SECURITY.md) for vulnerability reporting and self-hosting security practices.

---

## 💖 Acknowledgements & Inspirations

This project is deeply indebted to and inspired by the incredible work of the open-source manga community:

- **[Kotatsu](https://github.com/KotatsuApp/Kotatsu)** — For the reader interface, sliding window image caching concepts, and Kotlin parser ecosystem.
- **[Tachiyomi](https://github.com/tachiyomiorg) / [Mihon](https://github.com/mihonapp/mihon)** — For standardizing manga tracking, backup formats, and extensions.
- **[Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server)** — For pioneering self-hosted server architectures for manga.
- **[Paperback](https://github.com/Paperback-iOS)** & **[Komga](https://github.com/gotson/komga)** — For OPDS acquisition feeds and modern library UX design.
- **[MangaDex](https://mangadex.org)** — For their public API v5 powering title search, covers, and metadata enrichment.

---

## ⚖️ Legal Disclaimer

**Graywood Reader** is an open-source, self-hosted indexer, catalog manager, and reader application. It is provided strictly as a technical tool for organizing, browsing, and reading content that users already have access to or that is made available publicly on the internet.

- **No Content Hosting or Distribution:** The developers, maintainers, and contributors of Graywood Reader do not host, store, stream, publish, or distribute any copyrighted media, manga, manhwa, manhua, or comic chapters on any central server, cloud service, or within this repository.
- **Third-Party Sources & Parsers:**
  - All parser definitions, scraper scripts, and API connectors are technical instructions designed to interpret publicly accessible web documents and endpoints.
  - The developers have no ownership, affiliation, control, or partnership with any third-party websites, domains, CDNs, or scanlation groups accessed through these parsers.
  - We do not monitor, curate, or guarantee the accuracy, legality, safety, copyright status, or availability of any content hosted by third-party websites.
- **Local Caching & User Control:** Any temporary image proxying, browser storage (`IndexedDB`), or offline downloads (`STORAGE_PATH`) operate exclusively on the user's own local hardware or self-hosted server environment, executed solely at the user's direction.
- **User Responsibility:** Users assume full responsibility for how they use this software, including verifying that their access and storage of materials comply with applicable local copyright laws, intellectual property rights, and the terms of service of the third-party websites they access.
- **Copyright & DMCA Notices:** Because Graywood Reader is a standalone client software application that does not host or transmit media files through any developer-owned infrastructure, any copyright infringement claims or takedown notices regarding specific content must be directed to the third-party web hosts and source operators actually hosting the media.

---

## 📄 License

**Graywood Reader** is free software licensed under the **GNU General Public License v3.0 or later** (`GPL-3.0-or-later`). See [`LICENSE`](LICENSE) for the full text.

Third-party dependencies and vendored parser licenses are documented in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) and [`NOTICE`](NOTICE).

