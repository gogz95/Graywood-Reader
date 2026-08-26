# 💾 Storage Architecture & Data Mapping

This document provides a comprehensive mapping of how data, settings, caches, and media files are stored and managed in **Graywood Reader**. It also explains how the repository maintains a **100% clean-slate deployment** for new host installations.

---

## 🗺️ Storage Map & Directory Hierarchy

All runtime state, user profiles, reading progress, and cached assets are isolated under the `./data/` root directory (or browser storage on the client side).

```
Graywood-Reader/
│
├── [Source & Build Assets]           # Version controlled in Git (Zero user data)
│   ├── server.ts                     # API & web server entrypoint
│   ├── sqlite-db.ts / db/            # Database schema & parameterized DAL
│   ├── server/                       # Routers, security, scrapers, services
│   ├── src/                          # React 19 frontend components & stores
│   └── public/                       # PWA manifest, service worker, icons
│
└── data/                             # Host Runtime State (100% GIT-IGNORED)
    ├── manga.db                      # Primary SQLite database (WAL mode)
    ├── manga.db-wal                  # Write-Ahead Log (active writes)
    ├── manga.db-shm                  # Shared memory index
    │
    ├── image_cache/                  # Two-tier LRU proxy image cache
    │   └── <source_hash>/...         # Temporary image files with HTTP 304 ETags
    │
    ├── storage/                      # Server-side chapter downloads (.cbz)
    │   └── <manga_title>/...         # Downloaded ComicInfo.xml-compliant archives
    │
    ├── backups/                      # Rolling automated backup snapshots
    │   └── graywood_backup_*.json    # Encrypted JSON database snapshots
    │
    ├── extensions/                   # Dynamic community scraper plugins
    │   └── *.js                      # Sandboxed VM scraper scripts
    │
    ├── source-health.json            # Periodic scraper latency & liveness diagnostics
    │
    ├── .encryption-secret            # Host AES-256-GCM encryption secret (auto-generated)
    └── .admin-bootstrap-password     # One-time host admin initialization password
```

---

## 🛡️ Clean Slate Guarantee for New Deployments

When a new user or server administrator clones the repository, the working directory is in a pristine **zero-data state**:

1. **No Committed Databases**: Neither `data/manga.db`, `database.json`, nor sample user databases exist in Git tracking.
2. **No Committed Secrets or Passwords**: All `.env`, `.encryption-secret`, and `.admin-bootstrap-password` files are excluded.
3. **No Cached Images or Chapters**: Zero proxy caches, downloaded `.cbz` files, or temporary files are present.
4. **Automated First-Run Bootstrapping**:
   - On the initial run (`npm run start` or `docker compose up`), `db/connection.ts` automatically creates the `./data/` directory and generates a brand-new `manga.db` with all tables, indexes, and triggers.
   - `server/security.ts` automatically generates a secure 256-bit encryption secret and creates a default administrator profile.
   - The frontend detects a fresh installation and automatically opens the **Initial Setup Wizard** to guide the new host through account creation, source enablement, and initial library seeding.

---

## 🗄️ Database Entities & Schema Breakdown

The single `data/manga.db` SQLite database manages all domain models:

| Table Name | Purpose | Key Indexes |
|---|---|---|
| `manga` | Global catalog metadata, titles, authors, cover URLs, status, tags | `idx_manga_title`, `idx_manga_updated`, `idx_manga_isNsfw` |
| `profiles` | Multi-user accounts, usernames, hashed passwords, roles (`admin`/`user`) | `id` (PK) |
| `reading_progress` | User reading positions (`chapter_number`, `page_index`, `percent`) | `idx_read_progress_user` |
| `user_library_state` | Per-user reading status (`reading`, `completed`, `plan_to_read`, etc.) | `idx_user_lib_user` |
| `user_favorites` | User-specific series bookmarks / favorites | `idx_user_fav_user` |
| `categories` | Custom library shelves & dynamic rule-based smart collections | `idx_categories_user_sort` |
| `manga_categories` | Many-to-many relationship mapping manga to categories per user | `idx_manga_categories_composite` |
| `readlists` & `readlist_items` | Multi-series cross-story reading playlists and custom arcs | `idx_readlists_user`, `idx_readlist_items_list` |
| `page_sticky_notes` | Personal user notes anchored to specific chapter page numbers | `idx_sticky_notes_manga`, `idx_sticky_notes_user` |
| `download_jobs` | Background server download queue, retries, byte counters, and `.cbz` output paths | `idx_download_jobs_status`, `idx_download_jobs_manga` |
| `chapter_pages_cache` | Temporary cache of resolved chapter image URL lists (with TTL expiration) | `idx_chapter_cache_exp` |
| `revoked_tokens` | JWT / Session revocation blacklist | `idx_revoked_tokens_exp` |
| `logs` | Auto-update chapter release history and scraper change logs | `id` (PK) |

---

## 📱 Client-Side Storage Architecture

In addition to the server-side SQLite backend, Graywood Reader uses client storage for offline reading and UI personalization:

- **IndexedDB (`graywood_offline_v1`)**:
  - Stores complete chapter image blobs in the user's browser.
  - Enables 100% offline reading on mobile phones, tablets, or laptops without server access.
- **Browser LocalStorage**:
  - Remembers client-specific reader preferences (e.g. Webtoon 0px gap, Japanese Manga RTL, E-Ink high contrast, zoom level, background audio volume, and UI theme).
  - Stores client session tokens.

---

## 🐳 Docker Persistence & Volume Mounts

When running via Docker or Docker Compose, persistent data is mapped with a single volume mount:

```yaml
services:
  graywood-reader:
    image: graywood-reader
    volumes:
      - ./data:/app/data
```

### Why this is optimal:
- **Complete Instance Encapsulation**: Backing up the `./data/` folder backs up 100% of the instance (database, downloads, backups, secrets, and caches).
- **Seamless Container Updates**: Upgrading the Docker image leaves all persistent library data, user progress, and custom downloads intact.
- **Zero Host Contamination**: Nothing is written outside of `./data/`.

---

## 🔄 Backup & Migration Protocol

Graywood Reader includes built-in disaster recovery tools:

1. **Automated Scheduled Snapshots**: Creates periodic timestamped JSON dumps in `data/backups/` with rolling retention.
2. **Tachiyomi / Mihon Backups**: Standard bidirectional JSON backup export/import compatible with Mihon, Tachiyomi, and Kotatsu.
3. **Full Server Migration (`.zip`)**: Export and import complete instance state (SQLite database, settings, profiles, readlists, sticky notes) as a single compressed package via **Settings → Backup & Restore**.
