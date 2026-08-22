# Changelog

All notable changes to **Graywood Reader** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- GitHub Community Standard guidelines (`CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, issue & PR templates).
- Formal backend component version tracking registry (`server/version.ts`) and `/api/version` endpoint.
- **Multi-Provider Metadata Enricher expansion** (`metadata_enricher`):
  - **MangaUpdates**: rebuilt on the authenticated `PUT /v1/account/login` + `POST /v1/series` flow (public search was retired → HTTP 405), enriching titles with authors, categories, alt-titles, and Bayesian ratings. Degrades gracefully when credentials are not configured.
  - **Kitsu** backend metadata fetcher (JSON:API `/manga`), mapping rating `/100 → /10` and manhwa/manhua/novel subtypes.
  - **OpenLibrary** enricher (`search.json`) with cover URL construction from `cover_i` and subject→genre mapping.
  - **Google Books** enricher (`volumes/intitle:`) with `http→https` cover upgrade and 5-point→10-point rating conversion.
  - Per-provider rate-limiter (mirrors the existing MangaDex compliance pattern) and per-provider enablement toggles in `AppSettings`.
  - `GET /api/metadata/providers` introspection endpoint listing provider enablement and key-requirement status.
  - **MangaUpdates Acceptable Use Policy compliance**: provider response TTL cache (6h) so repeated title lookups don't re-hit the API, >=1200ms request spacing, and required attribution (`attribution` + `dataSources` fields). Compliance posture documented in `.agents/rules/mangaupdates-api.md`.

---

## [1.0.0] - 2026-08-18

### 🌟 Initial Release — "Genesis"

This release marks the baseline **Version 1.0.0** of **Graywood Reader**, consolidating the self-hosted manga/manhwa library tracker, Kotatsu-inspired reader, multi-source scraper engine, OPDS 1.2 catalog server, and SQLite storage layer into a unified, high-performance architecture.

#### 📚 Library & Discovery
- **Smart Library Management**: Reading statuses (`reading`, `completed`, `plan_to_read`, `on_hold`, `dropped`), unread counters, favorites, tags, and custom scores.
- **Multi-Select Bulk Actions**: Floating batch toolbar for status updates, bulk mark-as-read, and mass deletion.
- **Multi-Source Discovery Engine**: Search across MangaDex API v5, AniList, and 1,100+ Kotatsu-parser sources (Madara, MangaThemesia, WPComics, FoolSlide, custom HTML).

#### 📖 Reader Experience
- **Kotatsu-Inspired Reading Layouts**: Webtoon (Continuous & 0px Seamless), Japanese Manga Right-to-Left (RTL), Left-to-Right (LTR), Single Page, and Double-Page Book Spread.
- **Visual Shader Filters**: Normal, Line-Art Sharpener, E-Ink (e-paper high-contrast mode), OLED Ultra-Dark, Warm Sepia, and Grayscale.
- **Private Page Sticky Notes**: Anchor personal thoughts, theories, and notes to specific chapter pages with instant navigation.
- **Smart Guided Panel View**: Snap-to-panel scrolling for long-strip webtoon panels.
- **Granular Auto-Scroll & Instant Prefetch**: Smooth 60 FPS scrolling and zero-latency next chapter prefetching.
- **100% Offline Reading**: Client-side chapter download cache powered by browser `IndexedDB`.

#### 🔄 Sync & Integrations
- **Tachiyomi / Mihon JSON Backups**: Bidirectional backup export and import.
- **AniList GraphQL Scrobbler**: Automatic background scrobbling as chapters are completed.
- **OPDS 1.2 Catalog Server**: XML acquisition feeds for KOReader, Moon+ Reader, Panels, and Paperback (`/api/opds/catalog.xml`).
- **Anti-Bot Defense Bypass**: Cloudflare Turnstile, DDoS check, and Captcha bypass pipeline (FlareSolverr + 2Captcha/CapSolver).

#### 🏗️ Backend Components Baseline (v1.0.0)

All core backend subsystems start tracked at **v1.0.0**:

| Component Key | Component Name | Version | Entrypoint | Category |
|---|---|---|---|---|
| `core_server` | Core HTTP & API Server | `1.0.0` | [`server.ts`](server.ts) | Core |
| `sqlite_dal` | SQLite Database Access Layer | `1.0.0` | [`sqlite-db.ts`](sqlite-db.ts) | Database |
| `security_crypto` | Security & Cryptography Engine | `1.0.0` | [`server/security.ts`](server/security.ts) | Security |
| `rate_limiter` | Rate Limiting & DDoS Shield | `1.0.0` | [`server/rateLimit.ts`](server/rateLimit.ts) | Security |
| `scraper_engine` | Manga Scraper & Parser Runtime | `1.0.0` | [`server/sources/sourcesCatalog.ts`](server/sources/sourcesCatalog.ts) | Crawler |
| `bot_defense` | Anti-Bot & Captcha Bypass Pipeline | `1.0.0` | [`server/captchaSolver.ts`](server/captchaSolver.ts) | Crawler |
| `opds_server` | OPDS 1.2 Catalog Server | `1.0.0` | [`server/routes/opds.ts`](server/routes/opds.ts) | Integration |
| `local_library` | Local Archive & Storage Engine | `1.0.0` | [`server/routes/localLibrary.ts`](server/routes/localLibrary.ts) | Storage |
| `notes_engine` | Page-Anchored Sticky Notes Engine | `1.0.0` | [`server/routes/notes.ts`](server/routes/notes.ts) | Storage |

For details on the component versioning policy and how components increment, see [`VERSIONS.md`](VERSIONS.md).
