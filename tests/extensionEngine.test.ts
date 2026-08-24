import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ExtensionEngine } from '../server/sources/extensionEngine';

const TEST_DIR = path.join(process.cwd(), 'scratch', 'test-extensions');

describe('Dynamic Source Extension Engine', () => {
  let engine: ExtensionEngine;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    engine = new ExtensionEngine(TEST_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('installs, persists, and lists custom dynamic extensions', () => {
    const ext = engine.installExtension({
      id: 'ext_custom_test',
      name: 'Custom Test Extension',
      baseUrl: 'https://example-manga.com',
      lang: 'en',
      isNsfw: false,
      description: 'Test plugin',
    });

    expect(ext.id).toBe('ext_custom_test');
    expect(ext.enabled).toBe(true);

    const list = engine.getExtensions();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('Custom Test Extension');

    // Verify filesystem persistence
    const savedPath = path.join(TEST_DIR, 'ext_custom_test.json');
    expect(fs.existsSync(savedPath)).toBe(true);
  });

  it('executes custom JS search inside VM sandbox safely', async () => {
    engine.installExtension({
      id: 'ext_vm_test',
      name: 'VM Test Extension',
      baseUrl: 'https://test-manga.org',
      scriptContent: `
        function search(q) {
          return [
            { title: q + ' Chapter 1', url: baseUrl + '/ch1' },
            { title: q + ' Chapter 2', url: baseUrl + '/ch2' }
          ];
        }
      `,
    });

    const results = await engine.executeExtensionSearch('ext_vm_test', 'Solo Leveling');
    expect(results.length).toBe(2);
    expect(results[0].title).toBe('Solo Leveling Chapter 1');
    expect(results[0].url).toBe('https://test-manga.org/ch1');
  });

  it('supports async search functions (network-capable extensions)', async () => {
    engine.installExtension({
      id: 'ext_async_test',
      name: 'Async Test Extension',
      baseUrl: 'https://async-manga.org',
      scriptContent: `
        async function search(q) {
          // Simulate an async source round-trip without hitting the network.
          await new Promise((r) => setTimeout(r, 5));
          return [{ title: 'Async ' + q, url: '/manga/async-result', latestChapter: 7 }];
        }
      `,
    });

    const results = await engine.executeExtensionSearch('ext_async_test', 'Query');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('Async Query');
    // Relative URLs are resolved against the extension baseUrl.
    expect(results[0].url).toBe('https://async-manga.org/manga/async-result');
    expect(results[0].latestChapter).toBe(7);
  });

  it('blocks dynamic code generation (eval / Function) inside the sandbox', async () => {
    engine.installExtension({
      id: 'ext_eval_test',
      name: 'Eval Test Extension',
      baseUrl: 'https://eval-manga.org',
      scriptContent: `
        function search(q) {
          eval('globalThis.pwned = true');
          return [{ title: 'should not survive', url: 'https://eval-manga.org/x' }];
        }
      `,
    });

    // codeGeneration.strings=false makes eval throw; engine must fail safe.
    const results = await engine.executeExtensionSearch('ext_eval_test', 'x');
    expect(results).toEqual([]);
  });

  it('sanitizes malformed extension output instead of propagating it', async () => {
    engine.installExtension({
      id: 'ext_malformed_test',
      name: 'Malformed Test Extension',
      baseUrl: 'https://mal-manga.org',
      scriptContent: `
        function search() {
          return [
            null,
            'a string',
            { title: 42, url: 'https://mal-manga.org/notitle' },
            { title: 'No URL' },
            { title: 'Valid Entry', url: 'https://mal-manga.org/manga/valid', coverImage: 'https://mal-manga.org/c.jpg' },
          ];
        }
      `,
    });

    const results = await engine.executeExtensionSearch('ext_malformed_test', 'q');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('Valid Entry');
  });

  it('toggles and uninstalls extensions', () => {
    engine.installExtension({
      id: 'ext_toggle_test',
      name: 'Toggle Test',
      baseUrl: 'https://toggle.example.com',
    });

    expect(engine.toggleExtension('ext_toggle_test', false)).toBe(false);
    expect(engine.getEnabledExtensions().length).toBe(0);

    expect(engine.uninstallExtension('ext_toggle_test')).toBe(true);
    expect(engine.getExtensions().length).toBe(0);
  });

  it('converts enabled extensions to SourceDefinition objects for catalog integration', () => {
    engine.installExtension({
      id: 'ext_cat_test',
      name: 'Catalog Extension',
      baseUrl: 'https://cat.example.com',
      isNsfw: true,
    });

    const sourceDefs = engine.toSourceDefinitions();
    expect(sourceDefs.length).toBe(1);
    expect(sourceDefs[0].id).toBe('ext_cat_test');
    expect(sourceDefs[0].isNsfw).toBe(true);
  });
});
