import React, { useState } from 'react';
import { DatabaseSyncConfig, MangaItem } from '../types';
import {
  Database,
  Globe,
  Download,
  Upload,
  RotateCcw,
  CheckCircle,
  Save,
  Code,
  FileJson,
  FileText,
  Copy,
  Check,
} from 'lucide-react';

interface DatabaseSyncViewProps {
  config: DatabaseSyncConfig;
  mangaCount: number;
  onUpdateSubdomain: (subdomain: string) => void;
  onExportDb: (format: 'json' | 'csv') => void;
  onImportDb: (data: MangaItem[], replaceExisting: boolean) => void;
  onResetDb: () => void;
}

export const DatabaseSyncView: React.FC<DatabaseSyncViewProps> = ({
  config,
  mangaCount,
  onUpdateSubdomain,
  onExportDb,
  onImportDb,
  onResetDb,
}) => {
  const [subdomainInput, setSubdomainInput] = useState(config.subdomain);
  const [importText, setImportText] = useState('');
  const [replaceMode, setReplaceMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState('');

  const handleSaveSubdomain = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSubdomain(subdomainInput);
    setMsg('Subdomain configuration saved successfully!');
    setTimeout(() => setMsg(''), 3000);
  };

  const handleImportSubmit = () => {
    try {
      const parsed = JSON.parse(importText);
      const items = Array.isArray(parsed) ? parsed : parsed.data || [];
      if (!Array.isArray(items)) {
        alert('Invalid JSON format. Expected an array of Manga items.');
        return;
      }
      onImportDb(items, replaceMode);
      setImportText('');
      setMsg(`Successfully imported ${items.length} titles!`);
      setTimeout(() => setMsg(''), 3000);
    } catch (err) {
      alert('Failed to parse JSON text. Please check syntax.');
    }
  };

  const copyApiEndpoint = () => {
    const code = `curl -X GET "https://${config.subdomain}/api/manga"`;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/40 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-2">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold">
          <Database className="w-3.5 h-3.5 text-emerald-400" />
          Subdomain & Database Sync Center
        </div>
        <h2 className="text-2xl font-black text-slate-100 tracking-tight">
          Subdomain Routing & Sync Management
        </h2>
        <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
          Manage your tracking platform's custom subdomain, export full database backups, import external list data, or sync via open REST APIs.
        </p>

        {msg && (
          <div className="p-3 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center gap-2 mt-2">
            <CheckCircle className="w-4 h-4" />
            <span>{msg}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Subdomain & Domain Config */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-base font-bold text-slate-200 flex items-center gap-2">
            <Globe className="w-4 h-4 text-amber-400" />
            Subdomain Routing Configuration
          </h3>

          <form onSubmit={handleSaveSubdomain} className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-400 font-medium mb-1">
                Custom Subdomain Name:
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={subdomainInput}
                  onChange={(e) => setSubdomainInput(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold flex items-center gap-1.5 transition-all"
                >
                  <Save className="w-4 h-4" />
                  Save
                </button>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1 text-slate-400">
              <p className="text-slate-200 font-semibold">Live Subdomain URL:</p>
              <p className="font-mono text-amber-400 text-xs">https://{config.subdomain}</p>
              <p className="text-[11px] pt-1">
                This subdomain serves as your central Manhwa & Manhua tracking hub with live chapter updates.
              </p>
            </div>
          </form>
        </div>

        {/* Database Export & Backup */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-base font-bold text-slate-200 flex items-center gap-2">
            <Download className="w-4 h-4 text-cyan-400" />
            Export & Backup Database
          </h3>

          <p className="text-xs text-slate-300">
            Download your entire tracking database containing {mangaCount} series, chapter progress, ratings, and reading history.
          </p>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={() => onExportDb('json')}
              className="flex-1 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold text-xs border border-slate-700 flex items-center justify-center gap-2 transition-all"
            >
              <FileJson className="w-4 h-4 text-cyan-400" />
              Download JSON Backup
            </button>

            <button
              onClick={() => onExportDb('csv')}
              className="flex-1 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold text-xs border border-slate-700 flex items-center justify-center gap-2 transition-all"
            >
              <FileText className="w-4 h-4 text-emerald-400" />
              Download CSV Spreadsheets
            </button>
          </div>
        </div>

        {/* Import Database */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-base font-bold text-slate-200 flex items-center gap-2">
            <Upload className="w-4 h-4 text-orange-400" />
            Import Database / JSON Sync
          </h3>

          <div className="space-y-3 text-xs">
            <textarea
              rows={4}
              placeholder="Paste JSON database backup array here..."
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            />

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-slate-300 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceMode}
                  onChange={(e) => setReplaceMode(e.target.checked)}
                  className="rounded border-slate-700 text-orange-500 focus:ring-0"
                />
                <span>Replace existing database (Overwrite)</span>
              </label>

              <button
                onClick={handleImportSubmit}
                disabled={!importText.trim()}
                className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 font-bold transition-all disabled:opacity-50"
              >
                Import JSON
              </button>
            </div>
          </div>
        </div>

        {/* Reset / Sample Database */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-base font-bold text-slate-200 flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-red-400" />
            Database Seeder & Reset
          </h3>

          <p className="text-xs text-slate-300">
            Reload the initial pre-populated Manhwa & Manhua database containing Solo Leveling, Beginning After The End, Omniscient Reader, Martial Peak, and duplicate candidates for testing.
          </p>

          <button
            onClick={onResetDb}
            className="px-4 py-2.5 rounded-xl bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-500/30 font-bold text-xs transition-all flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            Reset to Sample Dataset
          </button>
        </div>
      </div>
    </div>
  );
};
