# Contributing to Graywood Reader

Thank you for your interest in contributing to **Graywood Reader**! 🎉

Whether you are fixing a bug, adding support for a new manga source, optimizing reader rendering performance, or improving documentation, your contributions are welcome.

Please take a moment to review this document to ensure an efficient and smooth collaboration process.

---

## 📋 Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
   - [Prerequisites](#prerequisites)
   - [Local Development Setup](#local-development-setup)
   - [Environment Configuration](#environment-configuration)
3. [Development Workflow](#development-workflow)
   - [Available Scripts](#available-scripts)
   - [Testing & Quality Checks](#testing--quality-checks)
4. [Project Architecture](#project-architecture)
5. [Contribution Guidelines](#contribution-guidelines)
   - [TypeScript & Code Style](#typescript--code-style)
   - [Database & Storage (SQLite)](#database--storage-sqlite)
   - [Reader Components & Performance](#reader-components--performance)
   - [Adding / Updating Parser Sources](#adding--updating-parser-sources)
6. [Commit & Branch Conventions](#commit--branch-conventions)
7. [Submitting a Pull Request](#submitting-a-pull-request)
8. [Reporting Issues](#reporting-issues)

---

## 📜 Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please report any unacceptable behavior to the project maintainers.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `≥ 22.12.0` (LTS recommended)
- **npm**: `≥ 10.0.0`
- **Git**
- Optional: **Docker** & **Docker Compose** (for containerized testing)

### Local Development Setup

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/<your-username>/Graywood-Reader.git
   cd Graywood-Reader
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
| `HOST` | Bind host address | `0.0.0.0` (Use `127.0.0.1` for local-only) |
| `ENCRYPTION_SECRET` | 32+ character hex or alphanumeric secret for PII/tokens | Generated on first run if omitted |
| `REQUIRE_AUTH` | `1` to require login for non-loopback clients, `0` for single-user | `0` |
| `STORAGE_PATH` | Directory for offline downloads and chapter cache | `./data` |
| `GEMINI_API_KEY` | Optional API key for AI search and smart tagging | Optional |

---

## 🛠️ Development Workflow

### Available Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Run development server with live reload (`tsx server.ts`) |
| `npm run build` | Full production build (`vite build` + `build:server`) |
| `npm run build:server` | Bundle backend with esbuild into `dist-server/server.cjs` |
| `npm run start` | Run compiled production bundle |
| `npm run lint` | Type-check TypeScript across client and server (`tsc --noEmit`) |
| `npm test` | Run test suite with Vitest (`vitest run`) |
| `npm run test:watch` | Run tests in interactive watch mode |
| `npm run reader:smoke` | Run scraper smoke tests for verification |
| `npm run electron:dev` | Launch desktop Electron development window |
| `npm run build:exe` | Package Windows standalone desktop binary |

### Testing & Quality Checks

Before submitting code, ensure all verification steps pass locally:

```bash
# 1. Verify TypeScript compiles cleanly
npm run lint

# 2. Run unit and integration tests
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
│   ├── routes/                # Modular route controllers (OPDS, auth, scraper, etc.)
│   ├── captchaSolver.ts       # Cloudflare Turnstile, FlareSolverr & 2Captcha pipeline
│   └── security.ts            # AES-256-GCM encryption, SSRF protection & auth
├── src/
│   ├── App.tsx                # Root React component, lazy modal routers & global state
│   ├── components/
│   │   ├── ReaderView.tsx     # Kotatsu-inspired reader (Webtoon, Double Spread, Shaders)
│   │   ├── LibraryView.tsx    # Library collection grid/table with multi-select actions
│   │   ├── BrowseModal.tsx    # Multi-source search & discovery modal
│   │   ├── SettingsModal.tsx  # User preferences, backup manager & sync integrations
│   │   └── ...
│   ├── hooks/                 # Reusable React hooks (e.g., useReaderSession)
│   └── utils/
│       ├── readingMode.ts     # Format detection & persistent reader settings
│       ├── offlineStorage.ts  # IndexedDB offline chapter cache engine
│       ├── tachiyomiImporter.ts # Tachiyomi v2 / Mihon JSON backup parser & exporter
│       └── aniListScrobbler.ts # AniList GraphQL scrobbling engine
├── kotatsu-parsers/           # Vendored Kotlin parser definitions
└── tests/                     # Unit and integration tests (Vitest + Supertest)
```

---

## 📐 Contribution Guidelines

### TypeScript & Code Style

- **Strict Type Checking**: Avoid `any` where possible. Use explicit interfaces or typed generics.
- **Modern JavaScript/TypeScript**: Use ES modules, async/await, and modern language features.
- **No Unused Code**: Clean up unused imports, dead variables, and legacy debug `console.log` statements.
- **Error Handling**: Wrap asynchronous I/O and external requests with robust `try/catch` blocks and return meaningful HTTP status codes / JSON error responses.

### Database & Storage (SQLite)

- All database access uses **`better-sqlite3`** with Write-Ahead Logging (`PRAGMA journal_mode = WAL`).
- Always use **parameterized queries** (`db.prepare('...').run(param)`) to prevent SQL injection.
- For bulk operations or multi-step mutations, wrap operations inside transactions (`db.transaction(...)`).

### Reader Components & Performance

- **Memory Efficiency**: The reader supports large image sets (hundreds of high-resolution pages). Ensure images outside the active sliding window are unmounted or cleaned up from DOM memory.
- **Layout Compatibility**: When modifying `ReaderView.tsx`, verify all layouts:
  - Long Strip / Webtoon (with 0px and standard gaps)
  - Japanese Manga Right-to-Left (RTL)
  - Left-to-Right (LTR)
  - Single Page
  - Double-Page Book Spread
- **E-Ink & Shaders**: Ensure visual shader filters (E-Ink, Sepia, Sharpener) apply cleanly via CSS/canvas filters without dropping frame rates.

### Adding / Updating Parser Sources

- Source scrapers should gracefully handle network failures, missing metadata, Cloudflare challenges, and DOM structural changes.
- Avoid hammering third-party servers; respect reasonable rate limits and timeouts.
- When creating or modifying scrapers, test with `npm run reader:smoke`.

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
4. **Fill out the PR Template**: Describe what was changed, why, and how you tested your changes. Include before/after screenshots or GIFs for UI/UX changes.
5. **Review Feedback**: Maintainers may ask for tweaks or clarifications during review. Respond promptly to feedback.

---

## 🐛 Reporting Issues

- **Bug Reports**: Use the [Bug Report](https://github.com/gogz95/Remix-ManhuaSync-to-a-reader/issues/new?template=bug_report.yml) template. Include your operating system, browser, server version, steps to reproduce, and relevant logs.
- **Source / Parser Issues**: Use the [Source Issue](https://github.com/gogz95/Remix-ManhuaSync-to-a-reader/issues/new?template=source_issue.yml) template if a specific scanlation source or parser stopped working.
- **Feature Requests**: Use the [Feature Request](https://github.com/gogz95/Remix-ManhuaSync-to-a-reader/issues/new?template=feature_request.yml) template with detailed use cases.
- **Security Vulnerabilities**: Do **not** open public issues for security vulnerabilities. Follow the instructions in [SECURITY.md](SECURITY.md).

---

Thank you for helping make **Graywood Reader** better for everyone! 📖✨
