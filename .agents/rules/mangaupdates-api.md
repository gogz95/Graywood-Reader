# MangaUpdates API — Acceptable Use Policy (MUST follow)

This file is the single source of truth for how Graywood Reader may use the
**MangaUpdates API**. Treat every rule as a hard requirement for any code path
that calls `api.mangaupdates.com` or serves MangaUpdates-derived data.

> **Note (2026-08):** MangaUpdates **retired the public search API**.
> `POST /v1/manga/search` now returns `405 "Method not allowed. Must be one
> of: OPTIONS"`. The only working lookup path is authenticated:
> 1. `PUT /v1/account/login` with `{ username, password }` (username + password
>    both mandatory; wrong creds → `401`).
> 2. `POST /v1/series` (requires the login session / `Authorization` header)
>    for title search.

## Acceptable Use Policy (verbatim requirements)

1. **Credit MangaUpdates** when using data provided by this API.
2. Use **reasonable spacing between requests** and **employ caching
   mechanisms** when accessing data.
3. You will NOT use MangaUpdates data or API in a way that will:
   - Deceive or defraud users
   - Assist or perform an illegal action
   - Create spam
   - Damage the database

## How the codebase satisfies these rules

### 1) Credit
- Every MangaUpdates result carries `attribution: 'Data via MangaUpdates API
  (mangaupdates.com)'`.
- Merged results expose `dataSources: string[]` listing every contributing
  provider (including `'MangaUpdates'`).
- The `UnifiedMetadataResult.provider` union includes `'MangaUpdates'`.
- `externalUrl` points to the canonical MangaUpdates series page.

### 2) Reasonable spacing
- `PROVIDER_THROTTLE_MS.mangaupdates = 1200` ms (≈0.8 req/s), enforced by
  `throttleProvider('mangaupdates')` before every authenticated request.

### 2) Caching
- `cachedProviderResult()` wraps every provider call in
  `server/services/metadataService.ts`.
- Only successful (non-null) results are cached; nulls are retried next call.
- MangaUpdates TTL = **6 hours** (`CACHE_TTL_MS.mangaupdates`).

### 3) No misuse
- MangaUpdates is used **strictly for metadata enrichment** (search-by-title,
  series record → title/altTitles/authors/categories/rating/description/cover).
- No reading/streaming, no bulk scraping beyond a single title lookup, no
  credential spamming (one login per enrichment cycle, throttled).
- All requests via `APP_USER_AGENT`, `AbortSignal.timeout(10000)`, graceful
  null on any failure.
- When MangaUpdates credentials are NOT configured, the provider is **skipped**
  (never silently breaks the aggregator).

## Edit guardrails for future changes
- Keep the throttle ≥ 1200 ms and the TTL cache in place.
- Preserve `attribution` on MangaUpdates results; do not strip it.
- Never add bulk/backfill loops against MangaUpdates.
- Never log or persist user MangaUpdates credentials in plaintext (they are
  held in `appSettings` and encrypted via `encryptPII` like other secrets).