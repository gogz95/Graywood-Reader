/**
 * Central Version Registry for Graywood Reader
 *
 * Tracks overall application release versioning alongside independent
 * semantic versioning for all core backend components and subsystems.
 */

export interface BackendComponentMeta {
  name: string;
  version: string;
  description: string;
  entrypoint: string;
  category: 'core' | 'database' | 'security' | 'crawler' | 'integration' | 'storage';
}

export const APP_VERSION = "1.0.0";
export const APP_NAME = "Graywood Reader";
export const APP_RELEASE_NAME = "Genesis";
export const APP_USER_AGENT = `Graywood-Reader/${APP_VERSION}`;

export const BACKEND_COMPONENTS: Record<string, BackendComponentMeta> = {
  core_server: {
    name: "Core HTTP & API Server",
    version: "1.0.0",
    description: "Express 5 application server, SPA routing, request lifecycle, and middleware",
    entrypoint: "server.ts",
    category: "core",
  },
  sqlite_dal: {
    name: "SQLite Database Access Layer",
    version: "1.0.0",
    description: "better-sqlite3 persistence engine with WAL mode, parameterized queries, and auto-migrations",
    entrypoint: "sqlite-db.ts",
    category: "database",
  },
  security_crypto: {
    name: "Security & Cryptography Engine",
    version: "1.0.0",
    description: "AES-256-GCM token and PII encryption, SSRF address validation, and host-gate authorization",
    entrypoint: "server/security.ts",
    category: "security",
  },
  rate_limiter: {
    name: "Rate Limiting & DDoS Shield",
    version: "1.0.0",
    description: "Sliding-window IP rate limiter and image proxy bandwidth protection",
    entrypoint: "server/rateLimit.ts",
    category: "security",
  },
  scraper_engine: {
    name: "Manga Scraper & Parser Runtime",
    version: "1.0.0",
    description: "Multi-source crawler with MangaDex API v5 client and Kotatsu Kotlin parser interpreter",
    entrypoint: "server/sources/sourcesCatalog.ts",
    category: "crawler",
  },
  bot_defense: {
    name: "Anti-Bot & Captcha Bypass Pipeline",
    version: "1.0.0",
    description: "FlareSolverr orchestrator with Cloudflare Turnstile, 2Captcha, and CapSolver solvers",
    entrypoint: "server/captchaSolver.ts",
    category: "crawler",
  },
  opds_server: {
    name: "OPDS 1.2 Catalog Server",
    version: "1.0.0",
    description: "Open Publication Distribution System XML acquisition feeds, search, and image proxying",
    entrypoint: "server/routes/opds.ts",
    category: "integration",
  },
  local_library: {
    name: "Local Archive & Storage Engine",
    version: "1.0.0",
    description: "CBZ/ZIP/folder scanner with adm-zip extraction and local offline chapter caching",
    entrypoint: "server/routes/localLibrary.ts",
    category: "storage",
  },
  notes_engine: {
    name: "Page-Anchored Sticky Notes Engine",
    version: "1.0.0",
    description: "Private annotations and chapter page sticky notes with SQLite persistence",
    entrypoint: "server/routes/notes.ts",
    category: "storage",
  },
};

export interface SystemVersionReport {
  app: {
    name: string;
    version: string;
    releaseName: string;
  };
  components: Record<string, BackendComponentMeta>;
  runtime: {
    node: string;
    platform: string;
    arch: string;
    uptimeSeconds: number;
    memoryUsageMB: number;
  };
}

export function getSystemVersionReport(): SystemVersionReport {
  const mem = process.memoryUsage();
  return {
    app: {
      name: APP_NAME,
      version: APP_VERSION,
      releaseName: APP_RELEASE_NAME,
    },
    components: BACKEND_COMPONENTS,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsageMB: Math.round(mem.rss / 1024 / 1024),
    },
  };
}
