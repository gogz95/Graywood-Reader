# Third-Party Notices & Open-Source Bill of Materials (BOM)

**Graywood Reader** is free software licensed under the **GNU General Public License v3.0 or later** (`GPL-3.0-or-later`). See [`LICENSE`](LICENSE) for the full license text.

The Software incorporates, adapts, or communicates with several third-party open-source components and APIs. Each component remains under its own license and copyright. This document provides a comprehensive Bill of Materials (BOM) for legal and open-source compliance.

---

## 1. Upstream Projects & Major Component Notices

### 1.1 Kotatsu & Kotatsu-Parsers
- **Project:** Kotatsu & kotatsu-parsers (`KotatsuApp/kotatsu-parsers`)
- **License:** GNU General Public License v3.0 (`GPL-3.0`)
- **Copyright:** © KotatsuApp contributors
- **Usage:** Parser definitions, catalog schemas, and reader architecture patterns located in `server/sources/catalog.json` and `server/sources/sourcesCatalog.ts`.
- **Compliance:** Because this component is licensed under GPL-3.0, the combined Software is distributed under GPL-3.0-or-later.

### 1.2 Mihon (formerly Tachiyomi)
- **Project:** Mihon (`mihonapp/mihon`)
- **License:** Apache License 2.0 (`Apache-2.0`)
- **SPDX ID:** `Apache-2.0`
- **Copyright:** © 2015 Javier Tomás; © 2024 Mihon Open Source Project
- **Full Text:** [http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)
- **Usage:** Source abstraction concepts (`Source`, `CatalogueSource`, `ParsedHttpSource`) and Tachiyomi JSON backup schema importer/exporter (`src/utils/tachiyomiImporter.ts`).
- **Compatibility:** Apache-2.0 is compatible with GPL-3.0-or-later.

### 1.3 Suwayomi-Server
- **Project:** Suwayomi-Server (`Suwayomi/Suwayomi-Server`)
- **License:** Mozilla Public License 2.0 (`MPL-2.0`)
- **SPDX ID:** `MPL-2.0`
- **Copyright:** © Suwayomi contributors
- **Usage:** OPDS 1.2 catalog structure and self-hosted server architecture reference.

### 1.4 MangaDex API
- **Service:** MangaDex (`mangadex.org`)
- **Usage:** Public API v5 integration for title searching, author metadata, tags, and cover image indexing.
- **Terms:** Used in compliance with MangaDex API guidelines, including rate-limiting and user-agent attribution.

---

## 2. Direct Runtime Dependencies

All direct production dependencies have been audited and verified for compatibility with the GPL-3.0-or-later license:

| Package | Version | License | SPDX ID | Purpose |
|---|---|---|---|---|
| `@google/genai` | `^2.4.0` | Apache License 2.0 | `Apache-2.0` | Optional Gemini AI search & recommendation features |
| `@tailwindcss/vite` | `^4.1.14` | MIT License | `MIT` | Styling build plugin for Vite |
| `adm-zip` | `^0.6.0` | MIT License | `MIT` | CBZ and migration archive packing / unpacking |
| `better-sqlite3` | `^13.0.3` | MIT License | `MIT` | High-speed C++ SQLite3 binding for Node.js |
| `cheerio` | `^1.2.0` | MIT License | `MIT` | Fast server-side HTML parser for scraper engines |
| `compression` | `^1.8.1` | MIT License | `MIT` | HTTP response gzip/deflate compression |
| `dotenv` | `^17.2.3` | BSD 2-Clause | `BSD-2-Clause` | Environment configuration management |
| `express` | `^5.2.1` | MIT License | `MIT` | Core HTTP & OPDS web application framework |
| `lucide-react` | `^1.31.0` | ISC License | `ISC` | UI icon set |
| `motion` | `^13.1.0` | MIT License | `MIT` | Smooth micro-animations and transitions |
| `react` | `^19.0.1` | MIT License | `MIT` | Frontend UI component library |
| `react-dom` | `^19.0.1` | MIT License | `MIT` | React DOM renderer |
| `react-router` | `^8.3.0` | MIT License | `MIT` | Client-side routing and navigation |
| `zustand` | `^5.0.15` | MIT License | `MIT` | Fast, lightweight client-side state management |

---

## 3. Direct Development & Build Dependencies

| Package | Version | License | SPDX ID | Purpose |
|---|---|---|---|---|
| `electron` | `^43.3.0` | MIT License | `MIT` | Desktop application container |
| `electron-builder` | `^26.15.3` | MIT License | `MIT` | Windows desktop packaging and NSIS installer |
| `esbuild` | `^0.28.2` | MIT License | `MIT` | Fast backend server bundler |
| `supertest` | `^7.2.2` | MIT License | `MIT` | HTTP integration testing |
| `tailwindcss` | `^4.1.14` | MIT License | `MIT` | Utility CSS framework |
| `tsx` | `^4.23.12` | MIT License | `MIT` | TypeScript execution runtime for Node.js |
| `typescript` | `~5.9.0` | Apache License 2.0 | `Apache-2.0` | TypeScript compiler and type checker |
| `vite` | `^8.2.1` | MIT License | `MIT` | Frontend build tool and HMR server |
| `vitest` | `^4.1.10` | MIT License | `MIT` | Unit and integration test runner |

---

## 4. Transitive Dependency Licensing Breakdown

An automated scan of all transitive dependencies in the dependency tree indicates the following license distribution:

- **MIT License**: 437 packages
- **ISC License**: 41 packages
- **BSD 2-Clause / 3-Clause**: 40 packages
- **Apache License 2.0**: 16 packages
- **Mozilla Public License 2.0 (MPL-2.0)**: 24 packages
- **0BSD / BlueOak / CC0-1.0 / WTFPL**: 12 packages

**Verification Result:** All transitive dependencies are governed by standard permissive or copyleft-compatible open-source licenses. There are **zero proprietary, non-commercial only, or conflicting license restrictions** within the dependency graph.

---

## 5. Software Bill of Materials (SBOM) Generation

To generate an exhaustive, machine-readable license audit report from the installed `node_modules`:

```bash
# Output CSV summary
npx license-checker --production --csv --out THIRD-PARTY-NPM.csv

# Output JSON summary
npx license-checker --production --json --out THIRD-PARTY-NPM.json
```

---

## 6. Disclaimer

This document is provided for informational and compliance purposes. It does not constitute formal legal advice.