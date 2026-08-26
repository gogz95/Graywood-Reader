# Contributing to Graywood Reader

Thank you for your interest in contributing to **Graywood Reader**! 🎉

Whether you are fixing a bug, adding a new source parser, optimizing reader rendering performance, enhancing security defenses, or improving documentation, your contributions help make the self-hosted manga reading experience better for everyone.

Please take a moment to review this guide before submitting issues or pull requests.

---

## 📋 Table of Contents

1. [Code of Conduct](#-code-of-conduct)
2. [Getting Started](#-getting-started)
   - [Prerequisites](#prerequisites)
   - [Local Development Setup](#local-development-setup)
   - [Environment Configuration](#environment-configuration)
3. [Development Workflow](#-development-workflow)
   - [Available Scripts](#available-scripts)
   - [Testing & Quality Checks](#testing--quality-checks)
4. [Project Architecture](#-project-architecture)
5. [Contribution Guidelines](#-contribution-guidelines)
   - [TypeScript & Code Quality](#typescript--code-quality)
   - [Database & Storage (SQLite WAL)](#database--storage-sqlite-wal)
   - [Reader Components & Performance](#reader-components--performance)
   - [Scraper & Parser Policy & Legal Compliance](#scraper--parser-policy--legal-compliance)
6. [Commit & Branch Conventions](#-commit--branch-conventions)
7. [Submitting a Pull Request](#-submitting-a-pull-request)
8. [Reporting Issues](#-reporting-issues)

---

## 📜 Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please report any unacceptable behavior to the project maintainers.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `≥ 22.12.0` (LTS recommended)
- **npm**: `≥ 10.0.0`
- **Git**
- Optional: **Docker** & **Docker Compose**

### Local Development Setup

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/<your-username>/Remix-ManhuaSync-to-a-reader.git
   cd Remix-ManhuaSync-to-a-reader
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

4. **Start the local development server:**
   ```bash
   npm run dev
   ```
   This starts the Express backend and Vite frontend hot-module replacement (HMR) at `http://localhost:3000`.

### Environment Configuration

Key configuration parameters in `.env`:

| Variable | Description | Default |
|---|---|---|
| `PORT` | Web server port | `3000` |
| `HOST` | Bind host address (`127.0.0.1` for local, `0.0.0.0` for containers) | `0.0.0.0` |
| `ENCRYPTION_SECRET` | 32+ character high-entropy key for PII and token encryption | *Auto-generated if omitted* |
| `REQUIRE_AUTH` | `1` to require login for non-loopback clients, `0` for single-user | `0` |
| `STORAGE_PATH` | Directory for offline downloads, caches, and backups | `./data` |
| `GEMINI_API_KEY` | Optional API key for AI search and smart tagging | *Optional* |

---

## 🛠️ Development Workflow

### Available Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Run development server with Vite HMR (`tsx server.ts`) |
| `npm run build` | Full production build (`vite build` + `build:server`) |
| `npm run build:server` | Bundle backend with esbuild into `dist-server/server.cjs` |
| `npm run start` | Run compiled production bundle |
| `npm run lint` | Type-check TypeScript across client and server (`tsc --noEmit`) |
| `npm test` | Run complete test suite with Vitest (`vitest run`) |
| `npm run test:watch` | Run tests in interactive watch mode |
| `npm run reader:smoke` | Run live scraper smoke tests |
| `npm run build:exe` | Package Windows standalone desktop binary |

### Testing & Quality Checks

Before submitting code, ensure all verification steps pass locally:

```bash
# 1. Verify TypeScript compiles cleanly with 0 errors
npm run lint

# 2. Run unit and integration tests (380+ tests)
npm test

# 3. Verify production bundling
npm run build
```

---

## 🏗️ Project Architecture

```
Graywood-Reader/
├── server.ts                  # Express 5 entrypoint, HTTP/OPDS routes & scraper engine
├── sqlite-db.ts               # better-sqlite3 database access layer (WAL mode)
├── server/
│   ├── routes/                # Modular route controllers (auth, manga, reader, sources, opds, gdpr)
│   ├── services/              # Crawler engine, metadata enrichers, download manager, migration
│   ├── captchaSolver.ts       # Cloudflare Turnstile, FlareSolverr & 2Captcha pipeline
│   ├── circuitBreaker.ts      # Source health circuit breaker and failure backoff
│   ├── rateLimit.ts           # IP rate-limiting & DDoS mitigation
│   └── security.ts            # AES-256-GCM encryption, SSRF protection & auth
├── src/
│   ├── App.tsx                # Root React component, lazy modal routers & global state
│   ├── components/            # Reader, Library, Browse, Settings, Modals
│   ├── hooks/                 # Custom React hooks (e.g., useReaderSession)
│   └── utils/                 # IndexedDB offline storage, Tachiyomi parser, AniList scrobbler
├── public/                    # PWA Web Manifest, service worker, static icons
└── tests/                     # 40+ Vitest test suites (380+ tests)
```

---

## 📐 Contribution Guidelines

### TypeScript & Code Quality

- **Strict Typing**: Avoid `any` where possible. Use explicit interfaces or typed generics.
- **Modern JavaScript/TypeScript**: Use ES modules, async/await, and modern language features.
- **Clean Code**: Remove dead code, unused imports, and stray debug `console.log` statements.
- **Error Handling**: Wrap asynchronous I/O and external requests with robust `try/catch` blocks and return meaningful HTTP status codes and JSON error payloads.

### Database & Storage (SQLite WAL)

- All database access uses **`better-sqlite3`** with Write-Ahead Logging (`PRAGMA journal_mode = WAL`).
- Always use **parameterized queries** (`db.prepare('...').run(param)`) to prevent SQL injection.
- For bulk operations or multi-step mutations, wrap operations inside transactions (`db.transaction(...)`).

### Reader Components & Performance

- **Memory Efficiency**: The reader supports large image sets (hundreds of high-resolution pages). Ensure images outside the active sliding window are unmounted or cleaned up from DOM memory.
- **Layout Verification**: When modifying `ReaderView.tsx`, verify all layouts:
  - Long Strip / Webtoon (0px and standard gaps)
  - Japanese Manga Right-to-Left (RTL)
  - Left-to-Right (LTR)
  - Single Page
  - Double-Page Book Spread
- **Shaders & Filters**: Ensure visual shader filters (E-Ink, Sepia, Sharpener, OLED) render at smooth 60 FPS without dropping frame rates.

### Scraper & Parser Policy & Legal Compliance

When adding or updating parser sources:
1. **Technical Parsing Only**: Scrapers must only interpret public HTML documents or public API endpoints. Never bundle, store, or redistribute copyrighted media in the repository.
2. **SSRF Guard**: Always route external HTTP requests through `fetchWithSsrfGuard` or configured proxy handlers to prevent intranet scanning.
3. **Respect Rate Limits**: Honor remote server limits, backoff on HTTP 429/503 responses, and use reasonable timeouts.
4. **Honest Metadata Policy**: Do not fabricate metadata (e.g. invented descriptions, hardcoded fake ratings, or artificial chapter counts). Report real parsed data.
5. **Legal Disclaimer Alignment**: Review [`DISCLAIMER.md`](DISCLAIMER.md) to ensure all new parsers comply with technical indexer principles.

---

## 🌿 Commit & Branch Conventions

### Branch Naming

Use descriptive branch names with a category prefix:

- `feat/add-mangadex-auth`
- `fix/webtoon-scroll-jitter`
- `perf/sqlite-index-optimization`
- `docs/update-opds-guide`

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body describing motivation and context]

[optional footer(s), e.g. Fixes #123]
```

**Common types:**
- `feat`: A new feature or capability
- `fix`: A bug fix
- `perf`: Performance improvement
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `docs`: Documentation updates
- `test`: Adding or correcting tests
- `chore`: Maintenance, build tasks, dependency bumps

---

## 🔄 Submitting a Pull Request

1. **Keep PRs Focused**: A pull request should ideally address a single concern, feature, or bug fix.
2. **Sync with Main**: Rebase or merge the latest `main` branch before submitting.
3. **Run CI Checks Locally**: Ensure `npm run lint`, `npm test`, and `npm run build` pass without warnings or errors.
4. **Fill out the PR Template**: Describe what was changed, why, and how you tested your changes.
5. **Check Legal Compliance**: Confirm that changes adhere to [`DISCLAIMER.md`](DISCLAIMER.md) and [`LICENSE`](LICENSE).

---

## 🐛 Reporting Issues

- **Bug Reports**: Use the [Bug Report](https://github.com/gogz95/Remix-ManhuaSync-to-a-reader/issues/new?template=bug_report.yml) template. Include your operating system, browser, server version, steps to reproduce, and relevant logs.
- **Source / Parser Issues**: Use the [Source Issue](https://github.com/gogz95/Remix-ManhuaSync-to-a-reader/issues/new?template=source_issue.yml) template if a specific scanlation source or parser stopped working.
- **Feature Requests**: Use the [Feature Request](https://github.com/gogz95/Remix-ManhuaSync-to-a-reader/issues/new?template=feature_request.yml) template with detailed use cases.
- **Security Vulnerabilities**: Do **not** open public issues for security vulnerabilities. Follow the instructions in [SECURITY.md](SECURITY.md).

---

Thank you for helping make **Graywood Reader** better for everyone! 📖✨
