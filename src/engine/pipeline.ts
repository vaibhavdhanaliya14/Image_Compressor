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
    description: 'Instagram feed standard; maximum vertical engagement (1080x1350)',
  },
  square: {
    name: 'square',
    label: 'Feed Square',
    ratioFraction: '1:1',
    aspectRatio: 1, // 1.00
    targetWidth: 1080,
    targetHeight: 1080,
    maxTargetKb: 500,
    description: 'Classic grid standard; uniform scaling (1080x1080)',
  },
  landscape: {
    name: 'landscape',
    label: 'Feed Landscape',
    ratioFraction: '1.91:1',
    aspectRatio: 1.91, // 1080 / 566
    targetWidth: 1080,
    targetHeight: 566,
    maxTargetKb: 400,
    description: 'Prevents horizontal letterbox padding (1080x566)',
  },
  stories: {
    name: 'stories',
    label: 'Stories & Reels',
    ratioFraction: '9:16',
    aspectRatio: 9 / 16, // 0.5625
    targetWidth: 1080,
    targetHeight: 1920,
    maxTargetKb: 750,
    description: 'Full vertical screen; bypasses story video/photo transcode (1080x1920)',
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
  unsharpAmount?: number;          // default 0.22 (22%)
  unsharpThreshold?: number;       // default 2
  progressive?: boolean;           // default true
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
  isProgressive: boolean;
  colorSpace: 'srgb';
}

export interface ExportResult {
  success: boolean;
  method: 'share' | 'download';
  aborted?: boolean;
  error?: string;
}

let picaInstance: Pica | null = null;
let mozjpegWasmModule: WebAssembly.Module | null = null;

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
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
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

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(blob);
  }

  bitmap = await applyMemoryGuard(bitmap);
  return { bitmap, size: originalSize };
}

/**
 * Post-resize screen unsharp mask convolution pass to restore micro-contrast.
 * Implements a Gaussian blur difference pass (sigma = 0.8, threshold = 2, amount = 22%)
 * to counter Instagram's 4:2:0 chroma subsampling softening.
 */
export function applyScreenUnsharpMask(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  amount = 0.22,
  threshold = 2
): void {
  if (amount <= 0) return;

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const copy = new Uint8ClampedArray(data);

  // 3x3 Gaussian convolution kernel approximating sigma = 0.8:
  // [1, 2, 1]
  // [2, 4, 2] / 16
  // [1, 2, 1]
  const kernel = [
    1 / 16, 2 / 16, 1 / 16,
    2 / 16, 4 / 16, 2 / 16,
    1 / 16, 2 / 16, 1 / 16,
  ];

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = (rowOffset + x) * 4;

      for (let c = 0; c < 3; c++) {
        let blurred = 0;
        let k = 0;
        for (let ky = -1; ky <= 1; ky++) {
          const kRow = (y + ky) * width;
          for (let kx = -1; kx <= 1; kx++) {
            blurred += copy[(kRow + (x + kx)) * 4 + c] * kernel[k++];
          }
        }

        const orig = copy[idx + c];
        const diff = orig - blurred;

        if (Math.abs(diff) > threshold) {
          const val = orig + diff * amount;
          data[idx + c] = val < 0 ? 0 : val > 255 ? 255 : val;
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/**
 * Encodes canvas to JPEG at specified quality (default 0.82).
 * Uses MozJPEG WebAssembly for Progressive JPEG encoding with trellis quantization when available,
 * falling back to canvas toBlob.
 */
async function encodeJpegOutput(
  canvas: HTMLCanvasElement,
  quality: number,
  progressive = true
): Promise<{ blob: Blob; isProgressive: boolean }> {
  try {
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (ctx && typeof WebAssembly !== 'undefined') {
      const { default: mozjpegEncode, init } = await import('@jsquash/jpeg/encode.js');

      if (!mozjpegWasmModule) {
        try {
          const wasmUrl = (await import('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm?url')).default;
          const wasmBinary = await fetch(wasmUrl).then((r) => r.arrayBuffer());
          mozjpegWasmModule = await WebAssembly.compile(wasmBinary);
          await init(mozjpegWasmModule);
        } catch (initErr) {
          console.warn('Custom MozJPEG wasm compile notice:', initErr);
        }
      }

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const arrayBuffer = await mozjpegEncode(imgData, {
        quality: Math.round(quality * 100),
        progressive,
        baseline: !progressive,
        trellis_multipass: true,
      });

      const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
      return { blob, isProgressive: progressive };
    }
  } catch (err) {
    console.warn('MozJPEG Wasm progressive encoder fallback:', err);
  }

  // Fallback to Pica/Canvas JPEG export
  const resizer = getPica();
  const blob = await resizer.toBlob(canvas, 'image/jpeg', quality);
  return { blob, isProgressive: false };
}

/**
 * Executes Core Image Pipeline:
 * 1. Target Width: Exactly 1080px (clamped max width)
 * 2. Aspect Ratio Presets: 4:5, 1:1, 1.91:1, 9:16
 * 3. Color Space: Standard sRGB forced via 2D Canvas context (8-bit per channel)
 * 4. Downsampling: Lanczos-3 interpolation via Pica
 * 5. Sharpening: Post-resize unsharp mask convolution pass
 * 6. Export Format: Progressive JPEG at 0.82 quality
 */
export async function processImage(
  source: File | Blob | string,
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const startTime = performance.now();

  const targetWidth = options.targetWidth ?? 1080;
  const quality = options.quality ?? 0.82;
  const aspectPreset = options.aspectPreset ?? 'portrait';
  const unsharpAmount = options.unsharpAmount !== undefined
    ? (options.unsharpAmount > 1 ? options.unsharpAmount / 100 : options.unsharpAmount)
    : 0.22;
  const unsharpThreshold = options.unsharpThreshold ?? 2;
  const progressive = options.progressive ?? true;

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

  // 3. Render uncompressed crop into intermediate Canvas forcing sRGB color space
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = clampedCropWidth;
  cropCanvas.height = clampedCropHeight;

  const cropCtx = cropCanvas.getContext('2d', {
    colorSpace: 'srgb',
    willReadFrequently: true,
  });
  if (!cropCtx) {
    bitmap.close();
    throw new Error('Could not acquire 2D sRGB rendering context for intermediate crop canvas.');
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

  const resizedCtx = resizedCanvas.getContext('2d', {
    colorSpace: 'srgb',
    willReadFrequently: true,
  });

  const resizer = getPica();
  await resizer.resize(cropCanvas, resizedCanvas, {
    quality: 3, // Lanczos-3
    filter: 'lanczos3',
  });

  // Intermediate crop canvas memory release
  cropCanvas.width = 0;
  cropCanvas.height = 0;

  // 5. Post-resize Screen Unsharp Mask / Convolution Pass to restore micro-contrast
  if (resizedCtx && unsharpAmount > 0) {
    applyScreenUnsharpMask(resizedCtx, targetWidth, targetHeight, unsharpAmount, unsharpThreshold);
  }

  // 6. Progressive JPEG Export at 0.82 quality
  const { blob: resultBlob, isProgressive } = await encodeJpegOutput(resizedCanvas, quality, progressive);

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
    isProgressive,
    colorSpace: 'srgb',
  };
}

/**
 * Phase 2 Native Share Sheet Export (navigator.share) with automatic fallback to file download.
 */
export async function exportJpeg(
  blob: Blob,
  filename = 'instagram_optimized_1080px.jpg'
): Promise<ExportResult> {
  const file = new File([blob], filename, { type: 'image/jpeg' });

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
          text: 'Resampled with Lanczos-3 to 1080px width at 0.82 quality in sRGB.',
        });
        return { success: true, method: 'share' };
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, method: 'share', aborted: true };
      }
      console.warn('Native Web Share notice; falling back to download:', err);
    }
  }

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
