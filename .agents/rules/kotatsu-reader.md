# Kotatsu Reader & Webtoon Source Extraction Rules

## 1. Asura Scans Extraction API
- **Endpoint 1 (Chapter List)**: `https://api.asurascans.com/api/series/{slug}/chapters`
- **Endpoint 2 (Page Panels)**: `https://api.asurascans.com/api/series/{slug}/chapters/{chapterSlug}`
- **Headers**: Must include `'Origin': 'https://asuracomic.net'` and `'Referer': 'https://asuracomic.net/'`.

## 2. Webtoon Panel Extraction Invariant
When extracting webtoon panel images from HTML or API feeds:
- Exclude metadata images: `/covers/`, `/profiles/`, `default-pp`, `avatar`, `logo`, `banner`, `icon`, `announcements`.
- Retain valid panel paths: `i.imgur.com`, `cdn.asurascans.com/asura-images/chapters/`, `flamecomics.xyz/wp-content/uploads/`, `luminousscans.org/wp-content/uploads/`.

## 3. Anti-Hotlink Blob Proxy Engine
- Route image requests through `/api/reader/proxy-image?url={targetUrl}&sourceUrl={sourceDomain}`.
- Attach host `Referer` (`https://{sourceDomain}`) and modern Chrome User-Agent.
- In client JS, convert ArrayBuffer response to `URL.createObjectURL(blob)` to bypass hotlink blocks.

## 5. Flame Comics Next.js API Extraction
- **Build ID Resolution**: Fetch `https://flamecomics.xyz/` and extract `buildId` from `/_next/static/([^/]+)/_buildManifest\.js`.
- **Catalog Endpoint**: `https://flamecomics.xyz/_next/data/{buildId}/browse.json` to get series ID mapping.
- **Series Endpoint**: `https://flamecomics.xyz/_next/data/{buildId}/series/{seriesId}.json`.
- **Chapter Endpoint**: `https://flamecomics.xyz/_next/data/{buildId}/series/{seriesId}/{token}.json?id={seriesId}&token={token}`.
- **Panel Image Format**: `https://flamecomics.xyz/_next/image?url=https%3A%2F%2Fcdn.flamecomics.xyz%2Fuploads%2Fimages%2Fseries%2F{seriesId}%2F{token}%2F{imgName}&w=1920&q=100`.
