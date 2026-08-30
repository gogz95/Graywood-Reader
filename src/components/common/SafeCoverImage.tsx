import React, { useState, useEffect } from 'react';
import { BookOpen } from 'lucide-react';

export interface SafeCoverImageProps {
  src?: string;
  alt: string;
  className?: string;
  fallbackMessage?: string;
  compact?: boolean;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'auto' | 'sync';
  onLoad?: () => void;
}

/**
 * SafeCoverImage renders cover art or a clean "Missing Page / Cover" placeholder UI.
 * It avoids requesting broken or hardcoded fallback images and stops any recursive error loops.
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
}) => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  const cleanSrc = src?.trim();

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
        setHasError(true);
      }}
    />
  );
};
