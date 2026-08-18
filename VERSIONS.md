# Backend Component & Subsystem Versions

This document details the versioning matrix, architecture boundaries, and increment rules for **Graywood Reader** and its individual backend components.

---

## 🧭 Overview & Philosophy

While the overall project uses unified semantic release tags (e.g. `v1.0.0`), the backend is composed of modular, distinct subsystems. Each subsystem maintains an explicit component version within [`server/version.ts`](server/version.ts) to facilitate granular debugging, API contract validation, and clean module decoupling.

Current Application Release: **`1.0.0`** (*Release: Genesis*)

---

## 📊 Component Version Registry

| Component Key | Subsystem Name | Version | Entrypoint | Description |
|---|---|---|---|---|
| `core_server` | **Core HTTP & API Server** | `1.0.0` | [`server.ts`](server.ts) | Express 5 server lifecycle, SPA static serving, error boundaries, and middleware orchestration. |
| `sqlite_dal` | **SQLite Database Access Layer** | `1.0.0` | [`sqlite-db.ts`](sqlite-db.ts) | `better-sqlite3` storage layer, WAL mode, schema initialization, auto-migrations, and ACID transactions. |
| `security_crypto` | **Security & Cryptography Engine** | `1.0.0` | [`server/security.ts`](server/security.ts) | AES-256-GCM encryption for secrets/tokens, SSRF private IP validation, and host-gate access control. |
| `rate_limiter` | **Rate Limiting & DDoS Shield** | `1.0.0` | [`server/rateLimit.ts`](server/rateLimit.ts) | In-memory sliding-window request throttling, proxy bandwidth caps, and client IP resolution. |
| `scraper_engine` | **Manga Scraper & Parser Runtime** | `1.0.0` | [`server/sources/sourcesCatalog.ts`](server/sources/sourcesCatalog.ts) | MangaDex v5 client, Kotatsu Kotlin parser interpreter, HTML/Cheerio scrapers, and source catalog health audit. |
| `bot_defense` | **Anti-Bot & Captcha Bypass Pipeline** | `1.0.0` | [`server/captchaSolver.ts`](server/captchaSolver.ts) | FlareSolverr session manager, Cloudflare Turnstile, 2Captcha, and CapSolver challenge bypass pipeline. |
| `opds_server` | **OPDS 1.2 Catalog Server** | `1.0.0` | [`server/routes/opds.ts`](server/routes/opds.ts) | Open Publication Distribution System XML acquisition feeds, search, pagination, and e-reader compatibility. |
| `local_library` | **Local Archive & Storage Engine** | `1.0.0` | [`server/routes/localLibrary.ts`](server/routes/localLibrary.ts) | Local CBZ/ZIP/folder scanning, zip extraction, image streaming, and offline chapter cache persistence. |
| `notes_engine` | **Page-Anchored Sticky Notes Engine** | `1.0.0` | [`server/routes/notes.ts`](server/routes/notes.ts) | Reader sticky notes DAL and REST routes for chapter page annotations. |

---

## 📡 Querying Component Versions via API

The server provides live endpoints for inspecting system and component versions:

### 1. Simple Health Check
```http
GET /api/health
```
**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 12.34,
  "databaseSize": 608
}
```

### 2. Full Component Version Report
```http
GET /api/version
```
**Response:**
```json
{
  "app": {
    "name": "Graywood Reader",
    "version": "1.0.0",
    "releaseName": "Genesis"
  },
  "components": {
    "core_server": {
      "name": "Core HTTP & API Server",
      "version": "1.0.0",
      "description": "Express 5 application server, SPA routing, request lifecycle, and middleware",
      "entrypoint": "server.ts",
      "category": "core"
    },
    "sqlite_dal": {
      "name": "SQLite Database Access Layer",
      "version": "1.0.0",
      "description": "better-sqlite3 persistence engine with WAL mode, parameterized queries, and auto-migrations",
      "entrypoint": "sqlite-db.ts",
      "category": "database"
    },
    "security_crypto": {
      "name": "Security & Cryptography Engine",
      "version": "1.0.0",
      "description": "AES-256-GCM token and PII encryption, SSRF address validation, and host-gate authorization",
      "entrypoint": "server/security.ts",
      "category": "security"
    }
  },
  "runtime": {
    "node": "v22.12.0",
    "platform": "win32",
    "arch": "x64",
    "uptimeSeconds": 12,
    "memoryUsageMB": 85
  }
}
```

---

## 📈 Version Increment Rules

When updating backend modules, increment component versions in [`server/version.ts`](server/version.ts) following Semantic Versioning (`MAJOR.MINOR.PATCH`):

1. **PATCH (`x.x.+1`)**:
   - Internal bug fixes, regex adjustments, parser selector updates.
   - Non-breaking error handling or logging improvements.
2. **MINOR (`x.+1.0`)**:
   - Adding new endpoints, supporting new scraper engine formats, new encryption algorithms.
   - Backward-compatible SQLite column additions or performance optimizations.
3. **MAJOR (`+1.0.0`)**:
   - Breaking API route changes, incompatible database schema migrations requiring manual intervention.
   - Removing deprecated protocols or complete subsystem rewrites.
