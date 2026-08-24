// ============================================================================
// DYNAMIC SOURCE EXTENSION ENGINE (Node vm Sandboxed Extension Runner)
// Allows installing, reloading, toggling, and executing community dynamic sources
// ============================================================================

import fs from 'fs';
import path from 'path';
import vm from 'node:vm';
import { SourceDefinition } from './sourcesCatalog';
import { fetchWithSsrfGuard } from '../security';

/** Hard caps for sandboxed extension execution (Mihon/Suwayomi parity). */
const EXTENSION_EXEC_TIMEOUT_MS = 15000;
const EXTENSION_FETCH_TIMEOUT_MS = 12000;
const MAX_EXTENSION_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB per fetch
const MAX_EXTENSION_RESULTS = 100;

/**
 * Headers an extension script is allowed to set on sandboxed fetch calls.
 * Credentials/host-spoofing headers are deliberately excluded.
 */
const SANDBOX_ALLOWED_HEADERS = new Set([
  'accept', 'accept-language', 'content-type', 'referer', 'x-requested-with',
]);

export interface DynamicExtensionManifest {
  id: string;
  name: string;
  version: string;
  baseUrl: string;
  lang: string;
  isNsfw: boolean;
  engine: 'custom_js' | 'json_selector';
  enabled: boolean;
  installedAt: string;
  scriptContent: string;
  description?: string;
  author?: string;
}

export interface ExtensionSearchResult {
  title: string;
  url: string;
  coverImage?: string;
  latestChapter?: number;
}

export class ExtensionEngine {
  private extensionsDir: string;
  private extensions: Map<string, DynamicExtensionManifest> = new Map();

  constructor(extensionsDir?: string) {
    this.extensionsDir = extensionsDir || path.join(process.cwd(), 'data', 'extensions');
    this.ensureDirectoryExists();
    this.loadInstalledExtensions();
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.extensionsDir)) {
      fs.mkdirSync(this.extensionsDir, { recursive: true });
    }
  }

  public loadInstalledExtensions(): DynamicExtensionManifest[] {
    this.extensions.clear();
    try {
      const files = fs.readdirSync(this.extensionsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.extensionsDir, file);
          const raw = fs.readFileSync(filePath, 'utf-8');
          try {
            const manifest: DynamicExtensionManifest = JSON.parse(raw);
            if (manifest.id && manifest.name) {
              this.extensions.set(manifest.id, manifest);
            }
          } catch (e: any) {
            console.warn(`[Extension Engine] Failed to parse ${file}:`, e.message);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Extension Engine] Error reading extensions dir:`, err.message);
    }
    return this.getExtensions();
  }

  public getExtensions(): DynamicExtensionManifest[] {
    return Array.from(this.extensions.values());
  }

  public getEnabledExtensions(): DynamicExtensionManifest[] {
    return this.getExtensions().filter((e) => e.enabled);
  }

  public getExtensionById(id: string): DynamicExtensionManifest | undefined {
    return this.extensions.get(id);
  }

  public installExtension(manifest: Partial<DynamicExtensionManifest>): DynamicExtensionManifest {
    if (!manifest.id || !manifest.name || !manifest.baseUrl) {
      throw new Error("Missing required extension fields (id, name, baseUrl)");
    }

    const fullManifest: DynamicExtensionManifest = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version || '1.0.0',
      baseUrl: manifest.baseUrl,
      lang: manifest.lang || 'en',
      isNsfw: Boolean(manifest.isNsfw),
      engine: manifest.engine || 'custom_js',
      enabled: manifest.enabled !== false,
      installedAt: new Date().toISOString(),
      scriptContent: manifest.scriptContent || `
        // Default extension scraper script.
        // Globals available in the sandbox:
        //   query   — the user's search string
        //   baseUrl — this extension's configured base URL
        //   fetch   — SSRF-guarded async fetch ({ ok, status, text(), json() })
        // Return an array of { title, url, coverImage?, latestChapter? }.
        async function search(query) {
          const res = await fetch(baseUrl + '/?s=' + encodeURIComponent(query) + '&post_type=wp-manga');
          if (!res.ok) return [];
          const html = await res.text();
          const results = [];
          const rx = /<a[^>]+href="([^"]*\\/manga\\/[^"]+)"[^>]*>([^<]+)<\\/a>/g;
          let m;
          while ((m = rx.exec(html)) !== null && results.length < 24) {
            results.push({ title: m[2].trim(), url: m[1] });
          }
          return results;
        }
      `,
      description: manifest.description || 'Community dynamic source plugin',
      author: manifest.author || 'Community',
    };

    const filePath = path.join(this.extensionsDir, `${fullManifest.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fullManifest, null, 2), 'utf-8');
    this.extensions.set(fullManifest.id, fullManifest);
    return fullManifest;
  }

  public toggleExtension(id: string, enabled?: boolean): boolean {
    const ext = this.extensions.get(id);
    if (!ext) return false;
    ext.enabled = enabled !== undefined ? enabled : !ext.enabled;
    const filePath = path.join(this.extensionsDir, `${ext.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(ext, null, 2), 'utf-8');
    return ext.enabled;
  }

  public uninstallExtension(id: string): boolean {
    const ext = this.extensions.get(id);
    if (!ext) return false;
    this.extensions.delete(id);
    const filePath = path.join(this.extensionsDir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  }

  /**
   * Build the SSRF-guarded fetch exposed to sandboxed extension scripts.
   * Extension code gets a Response-like facade ({ ok, status, url, text(),
   * json() }) — never the raw undici Response object — and every request hop
   * passes through fetchWithSsrfGuard (private-IP/DNS-rebinding protection).
   */
  private createSandboxedFetch(baseUrl: string) {
    const origin = (baseUrl || '').replace(/\/+$/, '');
    return async (input: unknown, options: any = {}) => {
      const raw = String(input ?? '');
      const absUrl = /^https?:\/\//i.test(raw)
        ? raw
        : `${origin}/${raw.replace(/^\/+/, '')}`;

      const method = String(options?.method || 'GET').toUpperCase();
      if (!['GET', 'POST', 'HEAD'].includes(method)) {
        throw new Error(`HTTP method "${method}" is not allowed in the extension sandbox`);
      }

      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
      };
      if (options?.headers && typeof options.headers === 'object') {
        for (const [k, v] of Object.entries(options.headers)) {
          if (SANDBOX_ALLOWED_HEADERS.has(k.toLowerCase()) && typeof v === 'string') {
            headers[k] = v.slice(0, 512);
          }
        }
      }

      const res = await fetchWithSsrfGuard(absUrl, {
        method,
        headers,
        body: method !== 'GET' && method !== 'HEAD' && typeof options?.body === 'string'
          ? options.body.slice(0, 100_000)
          : undefined,
        signal: AbortSignal.timeout(EXTENSION_FETCH_TIMEOUT_MS),
      });
      const text = (await res.text()).slice(0, MAX_EXTENSION_RESPONSE_BYTES);

      return {
        ok: res.ok,
        status: res.status,
        url: res.url,
        redirected: res.redirected,
        text: async () => text,
        json: async () => JSON.parse(text),
      };
    };
  }

  /**
   * Execute a custom JS extension's `search(query)` inside a hardened VM
   * sandbox.  Supports both sync and async search functions; async scripts
   * can call the sandboxed, SSRF-guarded `fetch` to reach their source.
   *
   * Hardening notes:
   *  - `codeGeneration: { strings: false, wasm: false }` blocks eval /
   *    new Function / WebAssembly escape hatches inside the context.
   *  - The VM `timeout` covers synchronous runaway loops; async completion
   *    is bounded by a host-side Promise.race timeout.
   *  - Node's `vm` is an isolation boundary, not a full security boundary:
   *    treat community extension scripts as semi-trusted input.
   */
  public async executeExtensionSearch(id: string, query: string): Promise<ExtensionSearchResult[]> {
    const ext = this.extensions.get(id);
    if (!ext || !ext.enabled) {
      throw new Error(`Extension ${id} is not installed or disabled.`);
    }

    const sandbox = {
      query: String(query ?? ''),
      baseUrl: ext.baseUrl,
      fetch: this.createSandboxedFetch(ext.baseUrl),
      console: { log: () => {}, warn: () => {}, error: () => {} },
      // Bounded timers so async extension scripts can pace themselves; the
      // outer Promise.race timeout still caps total execution time.
      setTimeout: (fn: () => void, ms?: number) =>
        setTimeout(fn, Math.min(Math.max(Number(ms) || 0, 0), 5000)),
      clearTimeout: (h: NodeJS.Timeout) => clearTimeout(h),
    };

    const context = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });
    const code = `
      (async () => {
        ${ext.scriptContent}
        if (typeof search === 'function') {
          return await search(query);
        }
        return [];
      })()
    `;

    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      const script = new vm.Script(code);
      const resultPromise = script.runInContext(context, { timeout: EXTENSION_EXEC_TIMEOUT_MS });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Extension ${id} timed out after ${EXTENSION_EXEC_TIMEOUT_MS}ms`)),
          EXTENSION_EXEC_TIMEOUT_MS,
        );
      });
      const raw = await Promise.race([Promise.resolve(resultPromise), timeoutPromise]);
      return this.sanitizeSearchResults(raw, ext.baseUrl);
    } catch (err: any) {
      console.error(`[Extension VM Sandbox Error] Source ${id}:`, err.message);
      return [];
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  /** Validate/normalize raw extension output into safe search results. */
  private sanitizeSearchResults(raw: unknown, baseUrl: string): ExtensionSearchResult[] {
    if (!Array.isArray(raw)) return [];
    const origin = (baseUrl || '').replace(/\/+$/, '');
    const out: ExtensionSearchResult[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const title = typeof rec.title === 'string' ? rec.title.trim() : '';
      let url = typeof rec.url === 'string' ? rec.url.trim() : '';
      if (!title || !url) continue;
      if (!/^https?:\/\//i.test(url)) {
        url = `${origin}/${url.replace(/^\/+/, '')}`;
      }
      const result: ExtensionSearchResult = { title: title.slice(0, 300), url: url.slice(0, 2048) };
      if (typeof rec.coverImage === 'string' && rec.coverImage) {
        result.coverImage = rec.coverImage.slice(0, 2048);
      }
      const lc = Number(rec.latestChapter);
      if (Number.isFinite(lc) && lc > 0) result.latestChapter = lc;
      out.push(result);
      if (out.length >= MAX_EXTENSION_RESULTS) break;
    }
    return out;
  }

  public toSourceDefinitions(): SourceDefinition[] {
    return this.getEnabledExtensions().map((ext) => ({
      id: ext.id,
      name: ext.name,
      baseUrl: ext.baseUrl,
      engineType: 'custom_html', // maps to generic engine
      lang: ext.lang,
      isNsfw: ext.isNsfw,
      supportsPopular: true,
      supportsLatest: true,
      supportsSearch: true,
    }));
  }
}

export const extensionEngine = new ExtensionEngine();
