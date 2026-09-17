import React, { useState, useEffect } from 'react';
import { BookOpen, ShieldOff } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';

export interface SafeCoverImageProps {
  src?: string;
  alt: string;
  className?: string;
  fallbackMessage?: string;
  compact?: boolean;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'auto' | 'sync';
  onLoad?: () => void;
  /** When true, applies blur concealment if the NSFW vault is currently locked. */
  isNsfw?: boolean;
}

/**
 * Session-wide cache of image URLs that failed to load (404/502/network failure).
 * Once a cover URL fails anywhere in the client, all other components skip requesting it.
 */
export const failedCoverUrls = new Set<string>();

/**
 * SafeCoverImage renders cover art or a clean "Missing Page / Cover" placeholder UI.
 * It avoids requesting broken or hardcoded fallback images and stops any recursive error loops.
 *
 * When `isNsfw` is true and the NSFW vault is locked, the cover is rendered with a
 * heavy 32px blur filter and an 18+ Vault overlay — concealing the artwork without
 * breaking the DOM layout. The blur lifts automatically once the vault is unlocked.
 */
export const SafeCoverImage: React.FC<SafeCoverImageProps> = ({
  src,
  alt,
  className = 'w-full h-full object-cover',
  fallbackMessage = 'Missing Page / Cover',
  compact = false,
  loading = 'lazy',
  decoding = 'async',
  onLoad,
  isNsfw = false,
}) => {
  const isVaultUnlocked = useAuthStore((s) => s.isVaultUnlocked);
  const shouldConceal = isNsfw && !isVaultUnlocked;

  const cleanSrc = src?.trim();
  const [hasError, setHasError] = useState(() => (cleanSrc ? failedCoverUrls.has(cleanSrc) : true));

  useEffect(() => {
    if (!cleanSrc) {
      setHasError(true);
      return;
    }
    // If the vault was just unlocked, allow retry for any previously failed NSFW covers
    if (isVaultUnlocked && failedCoverUrls.has(cleanSrc)) {
      failedCoverUrls.delete(cleanSrc);
      setHasError(false);
      return;
    }
    setHasError(failedCoverUrls.has(cleanSrc));
  }, [cleanSrc, isVaultUnlocked]);

  // ── NSFW vault concealment ──────────────────────────────────────────────────
  // While the vault is locked, render a dedicated 18+ Vault badge placeholder
  // without requesting the restricted asset across the wire or triggering 403 errors.
  if (shouldConceal) {
    return (
      <div
        className={`relative overflow-hidden flex flex-col items-center justify-center bg-slate-950/90 border border-rose-500/20 text-center select-none ${className}`}
        role="img"
        aria-label="18+ content — vault locked"
      >
        <div className="absolute inset-0 bg-radial from-rose-950/20 via-transparent to-black/60 pointer-events-none" />
        <div className="relative z-10 flex flex-col items-center justify-center gap-1.5 p-2">
          <ShieldOff className={`${compact ? 'w-4 h-4' : 'w-8 h-8'} text-rose-400 drop-shadow`} />
          {!compact && (
            <span className="text-[10px] font-black text-rose-300 tracking-wider uppercase px-2 py-0.5 rounded bg-rose-950/80 border border-rose-500/40 shadow-xs">
              18+ Vault
            </span>
          )}
        </div>
      </div>
    );
  }

  if (!cleanSrc || hasError) {
    return (
      <div
        className={`w-full h-full flex flex-col items-center justify-center bg-surface/90 border border-dashed border-edge/60 text-secondary gap-1.5 p-2 text-center select-none ${className}`}
        title={fallbackMessage}
      >
        <BookOpen className={`${compact ? 'w-4 h-4' : 'w-7 h-7'} opacity-40 text-secondary shrink-0`} />
        {!compact && (
          <span className="text-[10px] font-semibold text-secondary/80 leading-tight">
            {fallbackMessage}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={cleanSrc}
      alt={alt}
      loading={loading}
      decoding={decoding}
      className={className}
      onLoad={onLoad}
      onError={() => {
        if (cleanSrc) failedCoverUrls.add(cleanSrc);
        setHasError(true);
      }}
    />
  );
};
