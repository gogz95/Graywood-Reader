import React from 'react';
import {
  BookOpen,
  Shield,
  FileText,
  ExternalLink,
  Code2,
  Heart,
  Scale,
  Lock,
  Database,
  Cpu,
  Layers,
} from 'lucide-react';

export const AboutLegalTab: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* App Brand Header */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-app via-surface to-elevated border border-accent/20 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-2xl bg-accent text-accent-fg shadow-lg shadow-accent/20">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-black text-primary flex items-center gap-2">
                Graywood Reader
                <span className="px-2 py-0.5 rounded-md text-[11px] font-extrabold bg-accent/20 text-accent border border-accent/30">
                  v1.0.0 (Genesis)
                </span>
              </h3>
              <p className="text-xs text-secondary">
                Private, high-performance self-hosted manga library tracker &amp; Kotatsu-inspired reader.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="https://github.com/gogz95/Remix-ManhuaSync-to-a-reader"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-app border border-edge hover:border-accent/40 text-xs font-bold text-primary hover:text-accent transition-all cursor-pointer shadow-sm"
            >
              <Code2 className="w-4 h-4 text-accent" />
              <span>GitHub Repository</span>
              <ExternalLink className="w-3 h-3 text-muted" />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="p-3 rounded-xl bg-app/80 border border-edge/80 space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold text-primary">
              <Scale className="w-4 h-4 text-accent" />
              <span>Software License</span>
            </div>
            <p className="text-[11px] text-muted">GNU General Public License v3.0 or later (GPL-3.0-or-later)</p>
          </div>
          <div className="p-3 rounded-xl bg-app/80 border border-edge/80 space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold text-primary">
              <Database className="w-4 h-4 text-success" />
              <span>Data Engine</span>
            </div>
            <p className="text-[11px] text-muted">SQLite WAL Mode (better-sqlite3)</p>
          </div>
          <div className="p-3 rounded-xl bg-app/80 border border-edge/80 space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold text-primary">
              <Cpu className="w-4 h-4 text-accent-2" />
              <span>Parser Runtime</span>
            </div>
            <p className="text-[11px] text-muted">Kotatsu Engine v4.8 + FlareSolverr</p>
          </div>
        </div>
      </div>

      {/* Legal Disclaimer & Scope */}
      <div className="p-5 rounded-2xl bg-app border border-edge space-y-3">
        <div className="flex items-center gap-2.5 text-accent font-black text-sm">
          <Shield className="w-5 h-5 text-accent" />
          <span>Legal Disclaimer &amp; Terms of Use</span>
        </div>
        <p className="text-xs text-secondary leading-relaxed">
          Graywood Reader is strictly a technical indexing tool and client application. It operates entirely on your self-hosted hardware.
        </p>
        <ul className="space-y-2 text-xs text-primary/90 pt-1">
          <li className="flex items-start gap-2">
            <span className="text-accent font-bold">•</span>
            <span><strong>No Content Hosting:</strong> The developers do not host, store, stream, or distribute any copyrighted media or comic chapters.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent font-bold">•</span>
            <span><strong>Third-Party Scrapers:</strong> Scrapers and parsers are technical instructions interpreting publicly accessible web endpoints. Maintainers have no affiliation or partnership with any third-party websites.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent font-bold">•</span>
            <span><strong>Local Caching Only:</strong> Image proxying and downloads are executed locally on user command and stored on your local disk or browser IndexedDB.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent font-bold">•</span>
            <span><strong>DMCA / Infringement Notices:</strong> Must be directed to the third-party web hosts actually hosting the media.</span>
          </li>
        </ul>
        <div className="pt-2">
          <a
            href="https://github.com/gogz95/Remix-ManhuaSync-to-a-reader/blob/main/DISCLAIMER.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline font-bold"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Read full DISCLAIMER.md on GitHub</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Community Acknowledgements */}
      <div className="p-5 rounded-2xl bg-app border border-edge space-y-3">
        <div className="flex items-center gap-2.5 text-accent-2 font-black text-sm">
          <Heart className="w-5 h-5 text-accent-2" />
          <span>Open-Source Ecosystem Inspirations</span>
        </div>
        <p className="text-xs text-secondary">
          Graywood Reader is inspired by and builds upon pioneering projects in the open-source manga community:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div className="p-3 rounded-xl bg-surface border border-edge/60 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-primary">Kotatsu</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-app text-muted border border-edge">GPL-3.0</span>
            </div>
            <p className="text-[11px] text-muted">Reader layouts, sliding window caching, and Kotlin parser schemas.</p>
          </div>
          <div className="p-3 rounded-xl bg-surface border border-edge/60 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-primary">Tachiyomi / Mihon</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-app text-muted border border-edge">Apache-2.0</span>
            </div>
            <p className="text-[11px] text-muted">Manga tracking standards, backup formats, and source-api abstractions.</p>
          </div>
          <div className="p-3 rounded-xl bg-surface border border-edge/60 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-primary">Suwayomi-Server</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-app text-muted border border-edge">MPL-2.0</span>
            </div>
            <p className="text-[11px] text-muted">Self-hosted manga server architecture and OPDS integration reference.</p>
          </div>
          <div className="p-3 rounded-xl bg-surface border border-edge/60 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-primary">MangaDex</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-app text-muted border border-edge">API v5</span>
            </div>
            <p className="text-[11px] text-muted">Public metadata API, cover art enrichment, and title taxonomy.</p>
          </div>
        </div>
      </div>

      {/* Bill of Materials & Licenses Summary */}
      <div className="p-5 rounded-2xl bg-app border border-edge space-y-3">
        <div className="flex items-center gap-2.5 text-primary font-black text-sm">
          <Layers className="w-5 h-5 text-accent" />
          <span>Third-Party Software Bill of Materials (BOM)</span>
        </div>
        <p className="text-xs text-secondary">
          All runtime and build dependencies are verified open source and compatible with the GPL-3.0-or-later license:
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {[
            { name: 'React 19', lic: 'MIT' },
            { name: 'Express 5', lic: 'MIT' },
            { name: 'better-sqlite3', lic: 'MIT' },
            { name: 'Cheerio', lic: 'MIT' },
            { name: 'Motion', lic: 'MIT' },
            { name: 'Zustand', lic: 'MIT' },
            { name: 'TailwindCSS 4', lic: 'MIT' },
            { name: 'Lucide Icons', lic: 'ISC' },
            { name: 'Vite 8', lic: 'MIT' },
            { name: 'ADM-Zip', lic: 'MIT' },
            { name: 'TypeScript 5.9', lic: 'Apache-2.0' },
            { name: 'Google GenAI', lic: 'Apache-2.0' },
            { name: 'Dotenv', lic: 'BSD-2-Clause' },
          ].map((item) => (
            <div
              key={item.name}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-edge text-[11px]"
            >
              <span className="font-semibold text-primary">{item.name}</span>
              <span className="text-[10px] text-accent font-mono font-bold">({item.lic})</span>
            </div>
          ))}
        </div>
        <div className="pt-2 flex flex-wrap items-center gap-4">
          <a
            href="https://github.com/gogz95/Remix-ManhuaSync-to-a-reader/blob/main/THIRD-PARTY-NOTICES.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline font-bold"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>View Complete THIRD-PARTY-NOTICES.md</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="https://github.com/gogz95/Remix-ManhuaSync-to-a-reader/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline font-bold"
          >
            <Scale className="w-3.5 h-3.5" />
            <span>View Full GPL-3.0 LICENSE</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Local Privacy & Security Assurance */}
      <div className="p-4 rounded-xl bg-surface border border-edge flex items-start gap-3">
        <div className="p-2 rounded-lg bg-accent/10 text-accent">
          <Lock className="w-4 h-4" />
        </div>
        <div className="space-y-0.5">
          <h4 className="text-xs font-bold text-primary">Privacy &amp; Data Sovereignty</h4>
          <p className="text-[11px] text-secondary">
            Graywood Reader operates with 0 telemetry or tracking. All library data, reading progress, and credentials remain private on your server.
          </p>
        </div>
      </div>
    </div>
  );
};
