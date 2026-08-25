// ============================================================================
// SERVER-SIDE IMAGE OPTIMIZER & WEBP TRANSCODER
// Supports: Accept-header format negotiation (WebP/AVIF), quality compression,
// width scaling, and HTTP cache control for zero-lag reading.
// ============================================================================

import { Request } from 'express';

export interface ImageOptimizationOptions {
  format?: 'webp' | 'avif' | 'jpeg' | 'png' | 'original';
  quality?: number;
  width?: number;
}

export function parseOptimizationParams(req: Request): ImageOptimizationOptions {
  const reqFormat = (req.query.format as string || '').toLowerCase();
  const acceptHeader = req.headers['accept'] || '';

  let format: ImageOptimizationOptions['format'] = 'original';

  if (['webp', 'avif', 'jpeg', 'png'].includes(reqFormat)) {
    format = reqFormat as any;
  } else if (reqFormat === 'auto' || !reqFormat) {
    if (acceptHeader.includes('image/avif')) {
      format = 'avif';
    } else if (acceptHeader.includes('image/webp')) {
      format = 'webp';
    }
  }

  const qualityRaw = parseInt(req.query.quality as string || '80', 10);
  const quality = Math.max(10, Math.min(100, isNaN(qualityRaw) ? 80 : qualityRaw));

  const widthRaw = parseInt(req.query.w as string || req.query.width as string || '0', 10);
  const width = Math.max(0, Math.min(3840, isNaN(widthRaw) ? 0 : widthRaw));

  return { format, quality, width };
}

/**
 * Optimizes an image buffer according to client request parameters.
 * Falls back gracefully to original buffer if optional native modules are absent.
 */
export async function optimizeImageBuffer(
  inputBuffer: Buffer,
  contentType: string,
  options: ImageOptimizationOptions
): Promise<{ buffer: Buffer; contentType: string }> {
  // If format is original or input is already SVG, return un-modified
  if (options.format === 'original' || contentType.includes('svg')) {
    return { buffer: inputBuffer, contentType };
  }

  try {
    // Attempt dynamic sharp load if installed
    // @ts-ignore
    const sharpModule = await import('sharp').catch(() => null);
    const sharp = sharpModule?.default || sharpModule;

    if (sharp) {
      let instance = sharp(inputBuffer);

      if (options.width && options.width > 0) {
        instance = instance.resize({ width: options.width, withoutEnlargement: true });
      }

      if (options.format === 'webp') {
        instance = instance.webp({ quality: options.quality || 80 });
        return { buffer: await instance.toBuffer(), contentType: 'image/webp' };
      } else if (options.format === 'avif') {
        instance = instance.avif({ quality: options.quality || 75 });
        return { buffer: await instance.toBuffer(), contentType: 'image/avif' };
      } else if (options.format === 'jpeg') {
        instance = instance.jpeg({ quality: options.quality || 80 });
        return { buffer: await instance.toBuffer(), contentType: 'image/jpeg' };
      } else if (options.format === 'png') {
        instance = instance.png({ compressionLevel: 8 });
        return { buffer: await instance.toBuffer(), contentType: 'image/png' };
      }
    }
  } catch {
    // Sharp unavailable or failed processing — return original
  }

  return { buffer: inputBuffer, contentType };
}
