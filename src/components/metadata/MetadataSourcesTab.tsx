import React from 'react';
import {
  Globe,
  Layers,
  Star,
  ExternalLink,
  Wand2,
} from 'lucide-react';

interface SourceOption {
  sourceName: string;
  sourceUrl: string;
  title?: string;
  description?: string;
  coverImage?: string;
  covers?: Array<{ url: string; label?: string }>;
  rating?: number;
  genres?: string[];
  altTitles?: string[];
}

interface MetadataSourcesTabProps {
  sources: SourceOption[];
  onApplySourcePreset: (source: SourceOption) => void;
}

export const MetadataSourcesTab: React.FC<MetadataSourcesTabProps> = ({
  sources,
  onApplySourcePreset,
}) => {
  if (sources.length === 0) {
    return (
      <div className="p-8 text-center text-secondary bg-app/50 border border-edge rounded-xl space-y-2">
        <Globe className="w-8 h-8 mx-auto text-muted" />
        <p className="text-xs font-bold text-primary">No Connected Sources Found</p>
        <p className="text-[11px]">Click "Refresh Sources" to scan online providers for metadata presets.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sources.map((src, idx) => (
        <div key={idx} className="p-4 bg-app border border-edge rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-accent/20 text-accent border border-accent/30">
                {src.sourceName}
              </span>
              {src.title && <h5 className="text-xs font-bold text-primary">{src.title}</h5>}
            </div>

            <div className="flex items-center gap-2">
              <a
                href={src.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="p-1 rounded bg-elevated hover:bg-elevated/80 text-secondary hover:text-primary text-[11px]"
                title="View Source Webpage"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <button
                type="button"
                onClick={() => onApplySourcePreset(src)}
                className="px-3 py-1 rounded-lg bg-accent text-accent-fg font-bold text-xs flex items-center gap-1 hover:bg-accent/90 transition-all shadow-sm"
              >
                <Wand2 className="w-3 h-3" />
                <span>Adopt Preset</span>
              </button>
            </div>
          </div>

          {src.description && (
            <p className="text-[11px] text-secondary line-clamp-2 leading-relaxed bg-surface/50 p-2.5 rounded-lg">
              {src.description}
            </p>
          )}

          {src.genres && src.genres.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {src.genres.map((g, gIdx) => (
                <span
                  key={gIdx}
                  className="px-2 py-0.5 rounded text-[10px] font-medium bg-surface text-secondary border border-edge"
                >
                  {g}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
