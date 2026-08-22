// ============================================================================
// DYNAMIC SOURCE EXTENSION ENGINE (Node vm Sandboxed Extension Runner)
// Allows installing, reloading, toggling, and executing community dynamic sources
// ============================================================================

import fs from 'fs';
import path from 'path';
import vm from 'node:vm';
import { SourceDefinition } from './sourcesCatalog';

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
        // Default extension scraper script
        function search(query) {
          return [
            { title: query + " (Demo)", url: baseUrl + "/manga/demo", coverImage: "" }
          ];
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
   * Safe VM execution context for custom JS extensions
   */
  public executeExtensionSearch(id: string, query: string): ExtensionSearchResult[] {
    const ext = this.extensions.get(id);
    if (!ext || !ext.enabled) {
      throw new Error(`Extension ${id} is not installed or disabled.`);
    }

    const sandbox = {
      query,
      baseUrl: ext.baseUrl,
      results: [] as ExtensionSearchResult[],
      console: { log: () => {}, warn: () => {}, error: () => {} },
    };

    const context = vm.createContext(sandbox);
    const code = `
      ${ext.scriptContent}
      if (typeof search === 'function') {
        results = search(query);
      }
    `;

    try {
      const script = new vm.Script(code);
      script.runInContext(context, { timeout: 3000 });
      return Array.isArray(sandbox.results) ? sandbox.results : [];
    } catch (err: any) {
      console.error(`[Extension VM Sandbox Error] Source ${id}:`, err.message);
      return [];
    }
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
