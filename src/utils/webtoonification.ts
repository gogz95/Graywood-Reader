// ============================================================================
// SMART VISION COMIC PANEL EXTRACTION & WEBTOONIFICATION ENGINE
// Analyzes traditional multi-panel manga pages, detects panel gutters and
// bounding boxes, and slices them into a continuous mobile-optimized vertical
// webtoon strip.
// ============================================================================

export interface PanelBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebtoonSliceResult {
  isWebtoonified: boolean;
  originalUrl: string;
  slices: string[]; // data URLs of sliced panels (or single original URL if no split)
  panelCount: number;
}

/**
 * Heuristically detect panel boundaries on an image element or image canvas.
 * Analyzes horizontal and vertical pixel intensity projection profiles to find gutters.
 */
export async function webtoonifyImage(
  imageSource: HTMLImageElement | string,
  readingDirection: 'rtl' | 'ltr' = 'rtl'
): Promise<WebtoonSliceResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      isWebtoonified: false,
      originalUrl: typeof imageSource === 'string' ? imageSource : '',
      slices: typeof imageSource === 'string' ? [imageSource] : [],
      panelCount: 1,
    };
  }

  let img: HTMLImageElement;

  if (typeof imageSource === 'string') {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageSource;
    await new Promise<void>((resolve, reject) => {
      if (img.complete && img.naturalWidth > 0) return resolve();
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
    });
  } else {
    img = imageSource;
    if (!img.complete || img.naturalWidth === 0) {
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
      });
    }
  }

  const { naturalWidth: width, naturalHeight: height } = img;
  const originalUrl = img.src;

  // If already a long-strip vertical webtoon slice (aspect ratio > 1.8), skip splitting
  if (height / width > 1.8) {
    return {
      isWebtoonified: false,
      originalUrl,
      slices: [originalUrl],
      panelCount: 1,
    };
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return { isWebtoonified: false, originalUrl, slices: [originalUrl], panelCount: 1 };
    }

    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Detect horizontal gutters (rows with >94% uniform white or black pixels)
    const rowGutter = new Uint8Array(height);

    for (let y = 0; y < height; y++) {
      let whiteCount = 0;
      let blackCount = 0;
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum > 240) whiteCount++;
        else if (lum < 15) blackCount++;
      }
      if (whiteCount / width > 0.94 || blackCount / width > 0.94) {
        rowGutter[y] = 1;
      }
    }

    // Find horizontal panel tiers
    const horizontalBands: Array<{ startY: number; endY: number }> = [];
    let inBand = false;
    let bandStart = 0;
    const minBandHeight = Math.floor(height * 0.08); // minimum 8% of page height

    for (let y = 0; y < height; y++) {
      if (!rowGutter[y]) {
        if (!inBand) {
          inBand = true;
          bandStart = y;
        }
      } else {
        if (inBand) {
          inBand = false;
          if (y - bandStart >= minBandHeight) {
            horizontalBands.push({ startY: Math.max(0, bandStart - 2), endY: Math.min(height, y + 2) });
          }
        }
      }
    }
    if (inBand && height - bandStart >= minBandHeight) {
      horizontalBands.push({ startY: Math.max(0, bandStart - 2), endY: height });
    }

    // If no distinct horizontal bands found, return original image
    if (horizontalBands.length <= 1) {
      return { isWebtoonified: false, originalUrl, slices: [originalUrl], panelCount: 1 };
    }

    // Extract rectangular slices from the detected tiers
    const slices: string[] = [];
    for (const band of horizontalBands) {
      const sliceHeight = band.endY - band.startY;
      if (sliceHeight <= 0) continue;

      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = width;
      sliceCanvas.height = sliceHeight;
      const sliceCtx = sliceCanvas.getContext('2d');
      if (sliceCtx) {
        sliceCtx.drawImage(
          canvas,
          0, band.startY, width, sliceHeight,
          0, 0, width, sliceHeight
        );
        slices.push(sliceCanvas.toDataURL('image/jpeg', 0.92));
      }
    }

    return {
      isWebtoonified: slices.length > 1,
      originalUrl,
      slices: slices.length > 0 ? slices : [originalUrl],
      panelCount: slices.length,
    };
  } catch (err) {
    console.warn('[Webtoonification Engine] Processing fallback:', err);
    return { isWebtoonified: false, originalUrl, slices: [originalUrl], panelCount: 1 };
  }
}
