import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import {
  X,
  Puzzle,
  Download,
  Plus,
  Play,
  Trash2,
  Check,
  Code2,
  Layers,
  Sparkles,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Sliders,
} from 'lucide-react';

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  baseUrl: string;
  lang: string;
  isNsfw: boolean;
  engine: 'custom_js' | 'json_selector';
  enabled: boolean;
  installedAt: string;
  description?: string;
  author?: string;
  scriptContent?: string;
}

interface ExtensionManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const COMMUNITY_PRESETS = [
  {
    id: 'ext_madara_universal',
    name: 'Madara Universal WP Template',
    version: '1.2.0',
    baseUrl: 'https://manhuaplus.org',
    lang: 'en',
    isNsfw: false,
    author: 'Graywood Community',
    description: 'Generic scraper template for WordPress Madara comic themes with AJAX pagination.',
    engine: 'custom_js' as const,
    scriptContent: `// Universal Madara Scraper
function search(query) {
  return [
    { title: query + " [Madara]", url: baseUrl + "/manga/search?s=" + encodeURIComponent(query), coverImage: "" }
  ];
}`,
  },
  {
    id: 'ext_mangathemesia_universal',
    name: 'MangaThemesia Theme Scraper',
    version: '1.1.0',
    baseUrl: 'https://asuracomic.net',
    lang: 'en',
    isNsfw: false,
    author: 'Graywood Community',
    description: 'High-speed scraper template for MangaThemesia / Themez / WordPress manga themes.',
    engine: 'custom_js' as const,
    scriptContent: `// MangaThemesia Scraper
function search(query) {
  return [
    { title: query + " [Themesia]", url: baseUrl + "/?s=" + encodeURIComponent(query), coverImage: "" }
  ];
}`,
  },
  {
    id: 'ext_raw_korean_manhwa',
    name: 'NewToki / Raw Webtoon Template',
    version: '2.0.0',
    baseUrl: 'https://newtoki.com',
    lang: 'ko',
    isNsfw: false,
    author: 'Community Scrapers',
    description: 'Scraper template for Korean raw manhwa releases with automated mirror rotation.',
    engine: 'custom_js' as const,
    scriptContent: `// Raw Manhwa Scraper
function search(query) {
  return [
    { title: query + " (Raw)", url: baseUrl + "/webtoon?stx=" + encodeURIComponent(query), coverImage: "" }
  ];
}`,
  },
];

export const ExtensionManagerModal: React.FC<ExtensionManagerModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'installed' | 'store' | 'debugger'>('installed');
  const [extensions, setExtensions] = useState<ExtensionManifest[]>([]);
  const [loading, setLoading] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  // Debugger Sandbox State
  const [debugUrl, setDebugUrl] = useState('https://flamecomics.xyz');
  const [listSelector, setListSelector] = useState('article, .bsx, .manga-item');
  const [titleSelector, setTitleSelector] = useState('h2, h3, .tt, .title');
  const [linkSelector, setLinkSelector] = useState('a');
  const [coverSelector, setCoverSelector] = useState('img');
  const [debugTesting, setDebugTesting] = useState(false);
  const [debugResult, setDebugResult] = useState<any>(null);

  const fetchExtensions = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/extensions/list');
      if (res.ok) {
        const data = await res.json();
        setExtensions(Array.isArray(data) ? data : []);
      }
    } catch (_) {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) fetchExtensions();
  }, [isOpen]);

  const handleToggle = async (id: string, current: boolean) => {
    try {
      const res = await apiFetch(`/api/extensions/toggle/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !current }),
      });
      if (res.ok) {
        setExtensions((prev) => prev.map((e) => (e.id === id ? { ...e, enabled: !current } : e)));
      }
    } catch (_) {}
  };

  const handleUninstall = async (id: string) => {
    if (!confirm('Are you sure you want to uninstall this extension?')) return;
    try {
      const res = await apiFetch(`/api/extensions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setExtensions((prev) => prev.filter((e) => e.id !== id));
      }
    } catch (_) {}
  };

  const handleInstallPreset = async (preset: any) => {
    try {
      const res = await apiFetch('/api/extensions/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preset),
      });
      if (res.ok) {
        await fetchExtensions();
        setActiveTab('installed');
      }
    } catch (err: any) {
      alert(`Install failed: ${err.message}`);
    }
  };

  const handleImportFromUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importUrl.trim()) return;
    setImportError(null);
    try {
      const res = await apiFetch('/api/extensions/install-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      if (res.ok) {
        setImportUrl('');
        await fetchExtensions();
        setActiveTab('installed');
      } else {
        const err = await res.json().catch(() => ({}));
        setImportError(err.error || 'Failed to import from URL');
      }
    } catch (err: any) {
      setImportError(err.message || 'Import error');
    }
  };

  const handleTestSelector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!debugUrl.trim()) return;
    setDebugTesting(true);
    setDebugResult(null);
    try {
      const res = await apiFetch('/api/extensions/test-selector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: debugUrl.trim(),
          listSelector: listSelector.trim(),
          titleSelector: titleSelector.trim(),
          linkSelector: linkSelector.trim(),
          coverSelector: coverSelector.trim(),
        }),
      });
      const data = await res.json();
      setDebugResult(data);
    } catch (err: any) {
      setDebugResult({ error: err.message });
    } finally {
      setDebugTesting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-surface border border-edge rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-5 bg-app border-b border-edge flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-accent/15 text-accent border border-accent/20">
              <Puzzle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-primary flex items-center gap-2">
                Community Extension Manager &amp; Scraper Studio
              </h3>
              <p className="text-xs text-secondary">
                Install custom community scraper plugins or test CSS selectors live in the browser
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-elevated text-secondary hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-5 pt-3 border-b border-edge/60 bg-surface/50 text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('installed')}
            className={`pb-3 px-2 border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'installed'
                ? 'border-accent text-accent'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Installed Extensions ({extensions.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('store')}
            className={`pb-3 px-2 border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'store'
                ? 'border-accent text-accent'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            <Sparkles className="w-4 h-4 text-accent-2" />
            <span>Community Extension Store</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('debugger')}
            className={`pb-3 px-2 border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'debugger'
                ? 'border-accent text-accent'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>Live Selector Debugger</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* TAB 1: INSTALLED */}
          {activeTab === 'installed' && (
            <div className="space-y-4">
              {/* Import from URL bar */}
              <form onSubmit={handleImportFromUrl} className="flex gap-2">
                <input
                  type="url"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="Install via GitHub / Gist raw manifest JSON URL..."
                  className="flex-1 bg-app border border-edge rounded-xl px-3.5 py-2 text-xs text-primary placeholder-muted focus:outline-none focus:border-accent"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-accent text-accent-fg font-black text-xs rounded-xl flex items-center gap-1.5 hover:bg-accent-bright transition-all shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Import</span>
                </button>
              </form>

              {importError && (
                <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs text-danger">
                  {importError}
                </div>
              )}

              {loading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted">
                  <Loader2 className="w-6 h-6 animate-spin text-accent" />
                  <span className="text-xs">Loading extensions...</span>
                </div>
              ) : extensions.length === 0 ? (
                <div className="py-12 text-center bg-app/40 border border-edge rounded-2xl p-6 space-y-2">
                  <Puzzle className="w-8 h-8 text-muted mx-auto" />
                  <div className="text-xs font-bold text-primary">No community extensions installed</div>
                  <div className="text-[11px] text-secondary">
                    Browse the Community Store tab to install ready-to-use scraper templates or import via URL.
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('store')}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-fg rounded-xl text-xs font-bold"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Open Store
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {extensions.map((ext) => (
                    <div
                      key={ext.id}
                      className="p-3.5 bg-app border border-edge rounded-2xl flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs sm:text-sm font-bold text-primary truncate">
                            {ext.name}
                          </h4>
                          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-surface border border-edge text-secondary">
                            v{ext.version}
                          </span>
                          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-accent/10 text-accent border border-accent/20 uppercase">
                            {ext.lang}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted truncate mt-0.5">
                          {ext.description || ext.baseUrl}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggle(ext.id, ext.enabled)}
                          className={`px-3 py-1 rounded-xl text-xs font-bold border transition-all ${
                            ext.enabled
                              ? 'bg-success/15 text-success border-success/30'
                              : 'bg-elevated text-secondary border-edge hover:text-primary'
                          }`}
                        >
                          {ext.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUninstall(ext.id)}
                          className="p-1.5 rounded-xl text-secondary hover:text-danger hover:bg-elevated transition-colors"
                          title="Uninstall"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: STORE */}
          {activeTab === 'store' && (
            <div className="space-y-3">
              <div className="text-xs text-secondary font-bold">
                Curated Community Scraper Templates:
              </div>
              <div className="grid grid-cols-1 gap-3">
                {COMMUNITY_PRESETS.map((preset) => {
                  const isInstalled = extensions.some((e) => e.id === preset.id);
                  return (
                    <div
                      key={preset.id}
                      className="p-4 bg-app border border-edge rounded-2xl space-y-2 hover:border-accent/40 transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs sm:text-sm font-bold text-primary">{preset.name}</h4>
                            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-surface border border-edge text-secondary">
                              v{preset.version}
                            </span>
                            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-accent/10 text-accent uppercase">
                              {preset.lang}
                            </span>
                          </div>
                          <div className="text-[11px] text-accent mt-0.5">{preset.baseUrl}</div>
                        </div>

                        <button
                          type="button"
                          disabled={isInstalled}
                          onClick={() => handleInstallPreset(preset)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                            isInstalled
                              ? 'bg-success/20 text-success border border-success/30 cursor-default'
                              : 'bg-accent text-accent-fg hover:bg-accent-bright font-black shadow-sm'
                          }`}
                        >
                          {isInstalled ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                          <span>{isInstalled ? 'Installed' : 'Install'}</span>
                        </button>
                      </div>
                      <p className="text-[11px] text-secondary">{preset.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: LIVE SELECTOR DEBUGGER */}
          {activeTab === 'debugger' && (
            <div className="space-y-4">
              <form onSubmit={handleTestSelector} className="p-4 bg-app border border-edge rounded-2xl space-y-3">
                <div className="text-xs font-black text-primary flex items-center gap-1.5">
                  <Code2 className="w-4 h-4 text-accent" />
                  <span>Live CSS Selector Sandbox</span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-secondary mb-1">Target URL</label>
                  <input
                    type="url"
                    value={debugUrl}
                    onChange={(e) => setDebugUrl(e.target.value)}
                    placeholder="https://example-manga.com/series"
                    className="w-full bg-surface border border-edge rounded-xl px-3 py-2 text-xs text-primary focus:outline-none focus:border-accent"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-secondary mb-1">List Container Selector</label>
                    <input
                      type="text"
                      value={listSelector}
                      onChange={(e) => setListSelector(e.target.value)}
                      className="w-full bg-surface border border-edge rounded-xl px-3 py-2 text-xs text-primary focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-secondary mb-1">Title Selector</label>
                    <input
                      type="text"
                      value={titleSelector}
                      onChange={(e) => setTitleSelector(e.target.value)}
                      className="w-full bg-surface border border-edge rounded-xl px-3 py-2 text-xs text-primary focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-secondary mb-1">Link (Href) Selector</label>
                    <input
                      type="text"
                      value={linkSelector}
                      onChange={(e) => setLinkSelector(e.target.value)}
                      className="w-full bg-surface border border-edge rounded-xl px-3 py-2 text-xs text-primary focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-secondary mb-1">Cover Image (Src) Selector</label>
                    <input
                      type="text"
                      value={coverSelector}
                      onChange={(e) => setCoverSelector(e.target.value)}
                      className="w-full bg-surface border border-edge rounded-xl px-3 py-2 text-xs text-primary focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={debugTesting}
                    className="px-4 py-2 bg-gradient-to-r from-accent to-accent-2 text-accent-fg font-black text-xs rounded-xl flex items-center gap-1.5 shadow-md disabled:opacity-50"
                  >
                    {debugTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-accent-fg" />}
                    <span>{debugTesting ? 'Testing Selectors...' : 'Test Selectors Live'}</span>
                  </button>
                </div>
              </form>

              {/* Debugger Output */}
              {debugResult && (
                <div className="p-4 bg-app border border-edge rounded-2xl space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-primary">
                    <span>Extracted Results Preview:</span>
                    {debugResult.totalMatched !== undefined && (
                      <span className="text-accent">{debugResult.totalMatched} matches found</span>
                    )}
                  </div>

                  {debugResult.error ? (
                    <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs text-danger">
                      {debugResult.error}
                    </div>
                  ) : Array.isArray(debugResult.sampleResults) && debugResult.sampleResults.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {debugResult.sampleResults.map((item: any, i: number) => (
                        <div key={i} className="p-2.5 bg-surface border border-edge rounded-xl flex items-center gap-2.5">
                          {item.coverImage && (
                            <img src={item.coverImage} alt="" className="w-10 h-14 object-cover rounded-lg bg-app shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-primary truncate">{item.title}</div>
                            <div className="text-[10px] text-muted truncate">{item.url}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted italic">No items extracted with given selectors.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-app border-t border-edge flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-accent text-accent-fg font-bold text-xs shadow-md hover:bg-accent-bright transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
