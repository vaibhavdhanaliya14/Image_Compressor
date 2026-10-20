import pica, { type Pica } from 'pica';

export type InstagramPreset = 'portrait' | 'square' | 'stories' | 'landscape' | 'original' | 'custom';

export interface InstagramProfile {
  name: InstagramPreset;
  label: string;
  ratioFraction: string;
  aspectRatio: number; // width / height
  targetWidth: number;
  targetHeight: number;
  maxTargetKb: number;
  description: string;
}

export const INSTAGRAM_PROFILES: Record<'portrait' | 'square' | 'stories' | 'landscape', InstagramProfile> = {
  portrait: {
    name: 'portrait',
    label: 'Feed Portrait',
    ratioFraction: '4:5',
    aspectRatio: 4 / 5, // 0.80
    targetWidth: 1080,
    targetHeight: 1350,
    maxTargetKb: 600,
    description: 'Bypasses server bilinear crop; maximum feed engagement',
  },
  square: {
    name: 'square',
    label: 'Feed Square',
    ratioFraction: '1:1',
    aspectRatio: 1, // 1.00
    targetWidth: 1080,
    targetHeight: 1080,
    maxTargetKb: 500,
    description: 'Classic grid standard; minimum re-quantization',
  },
  stories: {
    name: 'stories',
    label: 'Stories & Reels',
    ratioFraction: '9:16',
    aspectRatio: 9 / 16, // 0.5625
    targetWidth: 1080,
    targetHeight: 1920,
    maxTargetKb: 750,
    description: 'Full vertical screen; bypasses story video/photo transcode',
  },
  landscape: {
    name: 'landscape',
    label: 'Feed Landscape',
    ratioFraction: '1.91:1',
    aspectRatio: 1.91,
    targetWidth: 1080,
    targetHeight: 566,
    maxTargetKb: 400,
    description: 'Prevents horizontal letterbox padding',
  },
};

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PipelineOptions {
  targetWidth?: number;            // default 1080
  targetHeight?: number;           // optional, computed from aspect ratio if omitted
  aspectPreset?: InstagramPreset;  // default 'portrait'
  customCrop?: CropRect;           // optional explicit crop coordinates (from react-easy-crop)
  quality?: number;                // default 0.82 (JPEG quality)
  unsharpAmount?: number;          // default 22
  unsharpRadius?: number;          // default 0.6
  unsharpThreshold?: number;       // default 2
}

export interface PipelineResult {
  blob: Blob;
  blobUrl: string;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  processingTimeMs: number;
  dimensions: {
    sourceWidth: number;
    sourceHeight: number;
    cropX: number;
    cropY: number;
    cropWidth: number;
    cropHeight: number;
    outputWidth: number;
    outputHeight: number;
  };
  preset: InstagramPreset;
  quality: number;
}

export interface ExportResult {
  success: boolean;
  method: 'share' | 'download';
  aborted?: boolean;
  error?: string;
}

let picaInstance: Pica | null = null;

/**
 * Returns a shared Pica resizer instance configured for high performance (Wasm + Web Workers).
 */
export function getPica(): Pica {
  if (!picaInstance) {
    picaInstance = pica({
      features: ['js', 'wasm', 'ww'],
      idle: 2000,
      concurrency: typeof navigator !== 'undefined' ? Math.min(navigator.hardwareConcurrency || 4, 4) : 4,
    });
  }
  return picaInstance;
}

/**
 * Calculates a default center-crop rectangle given the source dimensions and the target aspect ratio.
 */
export function calculateCenterCrop(sourceWidth: number, sourceHeight: number, targetRatio: number): CropRect {
  const sourceRatio = sourceWidth / sourceHeight;

  if (Math.abs(sourceRatio - targetRatio) < 0.001) {
    return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  }

  if (sourceRatio > targetRatio) {
    // Source is wider than target: clamp width, keep full height
    const width = Math.round(sourceHeight * targetRatio);
    const x = Math.round((sourceWidth - width) / 2);
    return { x, y: 0, width, height: sourceHeight };
  } else {
    // Source is taller than target: clamp height, keep full width
    const height = Math.round(sourceWidth / targetRatio);
    const y = Math.round((sourceHeight - height) / 2);
    return { x: 0, y, width: sourceWidth, height };
  }
}

/**
 * Memory Guard: Downscales extreme resolution images (>64MP) to prevent mobile browser OOM crashes.
 */
async function applyMemoryGuard(bitmap: ImageBitmap): Promise<ImageBitmap> {
  const maxPixels = 64_000_000; // 64 Megapixels
  const totalPixels = bitmap.width * bitmap.height;

  if (totalPixels <= maxPixels) {
    return bitmap;
  }

  const scale = Math.sqrt(maxPixels / totalPixels);
  const intermediateWidth = Math.round(bitmap.width * scale);
  const intermediateHeight = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = intermediateWidth;
  canvas.height = intermediateHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return bitmap;

  ctx.drawImage(bitmap, 0, 0, intermediateWidth, intermediateHeight);
  bitmap.close();

  const safeBitmap = await createImageBitmap(canvas);
  canvas.width = 0;
  canvas.height = 0;
  return safeBitmap;
}

/**
 * Loads an image from a File, Blob, or URL into an ImageBitmap (with EXIF auto-orientation).
 */
async function loadImageBitmap(source: File | Blob | string): Promise<{ bitmap: ImageBitmap; size: number }> {
  let blob: Blob;
  let originalSize = 0;

  if (typeof source === 'string') {
    const res = await fetch(source);
    blob = await res.blob();
    originalSize = blob.size;
  } else {
    blob = source;
    originalSize = source.size;
  }

  // createImageBitmap natively respects EXIF orientation in modern browsers
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // Fallback if imageOrientation option is unsupported
    bitmap = await createImageBitmap(blob);
  }

  // Check memory limits
  bitmap = await applyMemoryGuard(bitmap);

  return { bitmap, size: originalSize };
}

/**
 * Executes Resampling Pipeline:
 * 1. Crop extraction from custom coordinates or aspect calculation into intermediate canvas
 * 2. Lanczos-3 downscaling to target 1080px width via Pica.js with perceptual unsharp masking
 * 3. Deterministic JPEG encoding at 0.82 quality
 */
export async function processImage(
  source: File | Blob | string,
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const startTime = performance.now();

  const targetWidth = options.targetWidth ?? 1080;
  const quality = options.quality ?? 0.82;
  const aspectPreset = options.aspectPreset ?? 'portrait';
  const unsharpAmount = options.unsharpAmount ?? 22;
  const unsharpRadius = options.unsharpRadius ?? 0.6;
  const unsharpThreshold = options.unsharpThreshold ?? 2;

  // 1. Ingest image and decode
  const { bitmap, size: originalSize } = await loadImageBitmap(source);
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;

  // 2. Determine target dimensions and crop coordinates
  let targetHeight: number;
  let cropRect: CropRect;

  if (aspectPreset === 'original') {
    const sourceRatio = sourceWidth / sourceHeight;
    targetHeight = Math.round(targetWidth / sourceRatio);
    cropRect = options.customCrop ?? { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  } else if (aspectPreset === 'custom' && options.targetHeight) {
    targetHeight = options.targetHeight;
    cropRect = options.customCrop ?? calculateCenterCrop(sourceWidth, sourceHeight, targetWidth / targetHeight);
  } else {
    const profile = INSTAGRAM_PROFILES[aspectPreset as keyof typeof INSTAGRAM_PROFILES] ?? INSTAGRAM_PROFILES.portrait;
    targetHeight = profile.targetHeight;
    cropRect = options.customCrop ?? calculateCenterCrop(sourceWidth, sourceHeight, profile.aspectRatio);
  }

  // Ensure crop boundaries remain within source bounds without fractional distortion
  const clampedX = Math.max(0, Math.min(Math.round(cropRect.x), sourceWidth - 1));
  const clampedY = Math.max(0, Math.min(Math.round(cropRect.y), sourceHeight - 1));
  const clampedCropWidth = Math.max(1, Math.min(Math.round(cropRect.width), sourceWidth - clampedX));
  const clampedCropHeight = Math.max(1, Math.min(Math.round(cropRect.height), sourceHeight - clampedY));

  // 3. Render uncompressed crop into intermediate Canvas
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = clampedCropWidth;
  cropCanvas.height = clampedCropHeight;

  const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
  if (!cropCtx) {
    bitmap.close();
    throw new Error('Could not acquire 2D rendering context for intermediate crop canvas.');
  }

  // Draw pure uncompressed crop slice at 1:1 pixel scale
  cropCtx.drawImage(
    bitmap,
    clampedX,
    clampedY,
    clampedCropWidth,
    clampedCropHeight,
    0,
    0,
    clampedCropWidth,
    clampedCropHeight
  );

  // Release decoded ImageBitmap memory immediately
  bitmap.close();

  // 4. Lanczos-3 Resampling to clamped bounds (1080px width) via Pica
  const resizedCanvas = document.createElement('canvas');
  resizedCanvas.width = targetWidth;
  resizedCanvas.height = targetHeight;

  const resizer = getPica();
  await resizer.resize(cropCanvas, resizedCanvas, {
    quality: 3, // Lanczos-3
    filter: 'lanczos3',
    unsharpAmount,
    unsharpRadius,
    unsharpThreshold,
  });

  // Intermediate crop canvas is no longer needed; release memory
  cropCanvas.width = 0;
  cropCanvas.height = 0;

  // 5. Deterministic JPEG Export at specified quality (default 0.82)
  const resultBlob = await resizer.toBlob(resizedCanvas, 'image/jpeg', quality);

  // Clean up resized canvas memory
  resizedCanvas.width = 0;
  resizedCanvas.height = 0;

  const processingTimeMs = Math.round(performance.now() - startTime);
  const blobUrl = URL.createObjectURL(resultBlob);
  const compressedSize = resultBlob.size;
  const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 1;

  return {
    blob: resultBlob,
    blobUrl,
    width: targetWidth,
    height: targetHeight,
    originalSize,
    compressedSize,
    compressionRatio,
    processingTimeMs,
    dimensions: {
      sourceWidth,
      sourceHeight,
      cropX: clampedX,
      cropY: clampedY,
      cropWidth: clampedCropWidth,
      cropHeight: clampedCropHeight,
      outputWidth: targetWidth,
      outputHeight: targetHeight,
    },
    preset: aspectPreset,
    quality,
  };
}

/**
 * Phase 2 Native Share Sheet Export (navigator.share) with automatic fallback to file download.
 * Enables one-tap saving directly to iOS/Android Camera Roll / Photos app.
 */
export async function exportJpeg(
  blob: Blob,
  filename = 'instagram_optimized_1080px.jpg'
): Promise<ExportResult> {
  const file = new File([blob], filename, { type: 'image/jpeg' });

  // 1. Attempt native Web Share API with files if supported
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Instagram Optimized Image',
          text: 'Resampled with Lanczos-3 to 1080px width at 0.82 quality.',
        });
        return { success: true, method: 'share' };
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User dismissed the native share sheet
        return { success: false, method: 'share', aborted: true };
      }
      console.warn('Native Web Share failed or was rejected; falling back to download:', err);
    }
  }

  // 2. Direct browser file download fallback
  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { success: true, method: 'download' };
  } catch (err: unknown) {
    return {
      success: false,
      method: 'download',
      error: err instanceof Error ? err.message : 'Download failed',
    };
  }
}
