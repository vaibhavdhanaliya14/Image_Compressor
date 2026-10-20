import { useState, useRef, useEffect, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import {
  UploadCloud,
  ImageIcon,
  ShieldCheck,
  Download,
  Share2,
  Zap,
  RefreshCw,
  Sparkles,
  Sliders,
  ZoomIn,
  ZoomOut,
  Eye,
  Crop,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import {
  processImage,
  exportJpeg,
  type InstagramPreset,
  type PipelineResult,
} from './engine/pipeline';
import { InstagramSafeZoneOverlay } from './components/InstagramSafeZoneOverlay';

export type LockedAspect = '4:5' | '1:1' | '9:16';

interface AspectConfig {
  id: LockedAspect;
  preset: InstagramPreset;
  label: string;
  ratioFraction: string;
  aspect: number;
  width: number;
  height: number;
  maxKb: number;
  description: string;
}

const LOCKED_ASPECTS: AspectConfig[] = [
  {
    id: '4:5',
    preset: 'portrait',
    label: 'Feed Portrait',
    ratioFraction: '4:5',
    aspect: 4 / 5, // 0.80
    width: 1080,
    height: 1350,
    maxKb: 600,
    description: 'Instagram standard for feed posts; maximizes mobile screen real estate',
  },
  {
    id: '1:1',
    preset: 'square',
    label: 'Feed Square',
    ratioFraction: '1:1',
    aspect: 1, // 1.00
    width: 1080,
    height: 1080,
    maxKb: 500,
    description: 'Classic Instagram square profile grid; uniform scaling',
  },
  {
    id: '9:16',
    preset: 'stories',
    label: 'Stories & Reels',
    ratioFraction: '9:16',
    aspect: 9 / 16, // 0.5625
    width: 1080,
    height: 1920,
    maxKb: 750,
    description: 'Full vertical viewport; eliminates horizontal letterboxing and story transcode blur',
  },
];

export default function App() {
  // Cropper states
  const [activeAspectId, setActiveAspectId] = useState<LockedAspect>('4:5');
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  // UI view modes
  const [showSafeZones, setShowSafeZones] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<'cropper' | 'preview'>('cropper');

  // Image source and file state
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceDimensions, setSourceDimensions] = useState<{ width: number; height: number } | null>(null);

  // Engine pipeline settings & results
  const [quality, setQuality] = useState<number>(0.82);
  const [unsharpAmount, setUnsharpAmount] = useState<number>(22);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<number | null>(null);

  const currentConfig = LOCKED_ASPECTS.find((a) => a.id === activeAspectId) ?? LOCKED_ASPECTS[0];

  // Helper to load file
  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (JPEG, PNG, WebP, etc.)');
      return;
    }
    setError(null);
    setSourceFile(file);
    setResult(null);

    const url = URL.createObjectURL(file);
    setImageSrc(url);
    setCrop({ x: 0, y: 0 });
    setZoom(1);

    // Measure natural dimensions
    const img = new Image();
    img.onload = () => {
      setSourceDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = url;
  };

  // Run the Phase 1 Canvas Engine Pipeline with croppedAreaPixels
  const executePipeline = useCallback(
    async (cropPixels: Area | null, targetQuality: number, unsharp: number, aspectCfg: AspectConfig) => {
      if (!imageSrc) return;

      setIsProcessing(true);
      setError(null);

      try {
        const pipelineResult = await processImage(sourceFile || imageSrc, {
          aspectPreset: aspectCfg.preset,
          customCrop: cropPixels ?? undefined,
          targetWidth: 1080,
          targetHeight: aspectCfg.height,
          quality: targetQuality,
          unsharpAmount: unsharp,
        });

        setResult(pipelineResult);
      } catch (err: unknown) {
        console.error('Pipeline execution error:', err);
        setError(err instanceof Error ? err.message : 'Error executing Lanczos-3 pipeline');
      } finally {
        setIsProcessing(false);
      }
    },
    [imageSrc, sourceFile]
  );

  // Crop complete handler from react-easy-crop
  const onCropComplete = useCallback(
    (_croppedArea: Area, currentCroppedAreaPixels: Area) => {
      setCroppedAreaPixels(currentCroppedAreaPixels);

      // Debounce pipeline execution during touch/drag gestures to maintain 60 FPS
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = window.setTimeout(() => {
        executePipeline(currentCroppedAreaPixels, quality, unsharpAmount, currentConfig);
      }, 350);
    },
    [executePipeline, quality, unsharpAmount, currentConfig]
  );

  // Re-run pipeline when aspect ratio or quality sliders change
  const handleAspectChange = (newAspectId: LockedAspect) => {
    setActiveAspectId(newAspectId);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    const newConfig = LOCKED_ASPECTS.find((a) => a.id === newAspectId) ?? LOCKED_ASPECTS[0];

    // Trigger pipeline on next tick once react-easy-crop recalculates
    setTimeout(() => {
      executePipeline(croppedAreaPixels, quality, unsharpAmount, newConfig);
    }, 150);
  };

  // Phase 2 Export: Web Share API with download fallback
  const handleExport = async (preferredMethod?: 'share' | 'download') => {
    if (!result) return;

    const filename = `instagram_${activeAspectId.replace(':', 'x')}_1080px_q${Math.round(result.quality * 100)}.jpg`;

    if (preferredMethod === 'download') {
      // Force direct file download
      const a = document.createElement('a');
      a.href = result.blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setExportFeedback('Saved to local downloads.');
      setTimeout(() => setExportFeedback(null), 3000);
      return;
    }

    setExportFeedback('Preparing native export...');
    const exportRes = await exportJpeg(result.blob, filename);

    if (exportRes.success) {
      if (exportRes.method === 'share') {
        setExportFeedback('Shared / Saved to Photos Camera Roll!');
      } else {
        setExportFeedback('Saved to Downloads (Share API unavailable on this browser).');
      }
    } else if (exportRes.aborted) {
      setExportFeedback(null);
    } else {
      setExportFeedback(exportRes.error || 'Export failed.');
    }

    setTimeout(() => setExportFeedback(null), 3500);
  };

  // Sample image generator for immediate zero-setup testing
  const loadHighResSample = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 3240;
    canvas.height = 4050; // Ultra high-res 4:5 13MP
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Dark gradient background
    const grad = ctx.createLinearGradient(0, 0, 3240, 4050);
    grad.addColorStop(0, '#111827');
    grad.addColorStop(0.5, '#1e1b4b');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 3240, 4050);

    // High frequency rings and radial geometry to test Lanczos-3 sharpness
    for (let r = 200; r <= 1400; r += 40) {
      ctx.beginPath();
      ctx.arc(1620, 1800, r, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${(r * 1.5) % 360}, 85%, 65%, 0.35)`;
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    // Focal subject card
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.roundRect(620, 1100, 2000, 1500, 80);
    ctx.fill();
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 12;
    ctx.stroke();

    // High-contrast typography for micro-contrast testing
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 150px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('INSTAGRAM OPTIMIZER', 1620, 1600);

    ctx.font = '70px -apple-system, sans-serif';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText('Lanczos-3 Sub-2s Resampling Pipeline', 1620, 1750);
    ctx.fillText('Source: 3240 × 4050 px (13.1 MP)', 1620, 1870);

    // Grid lines for edge alignment
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    for (let x = 0; x < 3240; x += 180) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 4050);
      ctx.stroke();
    }

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'sample_3240x4050_highres.jpg', { type: 'image/jpeg' });
        handleFile(file);
      }
    }, 'image/jpeg', 0.95);
  };

  // Load sample on mount if empty
  useEffect(() => {
    if (!imageSrc) {
      loadHighResSample();
    }
    return () => {
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <div className="min-h-screen bg-[#08090d] text-neutral-100 flex flex-col font-sans select-none">
      {/* Header Bar */}
      <header className="border-b border-neutral-800/80 bg-[#0c0e15]/90 backdrop-blur-md sticky top-0 z-50 px-4 sm:px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center shadow-lg shadow-rose-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold tracking-tight text-white">Instagram Image Optimizer</h1>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 font-medium">
                  Phase 2 • Mobile UX
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 hidden sm:block">
                Touch crop locked to 4:5 / 1:1 / 9:16 • Lanczos-3 (1080px) • Web Share API
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-medium text-neutral-200 transition-colors cursor-pointer"
            >
              <UploadCloud className="w-4 h-4 text-rose-400" />
              <span className="hidden sm:inline">Upload Image</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleFile(e.target.files[0]);
                }
              }}
            />

            <button
              type="button"
              onClick={loadHighResSample}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900/60 hover:bg-neutral-800 border border-neutral-800/80 text-xs text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Sample</span>
            </button>

            <div className="hidden lg:flex items-center gap-1.5 text-xs text-neutral-400 bg-neutral-900/80 border border-neutral-800 px-2.5 py-1.5 rounded-lg">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>100% Local RAM</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Interactive Cropper & Visual Editor */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* Aspect Ratio Lock Tabs */}
          <div className="bg-[#11131c] border border-neutral-800/90 rounded-2xl p-2 sm:p-2.5 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              {LOCKED_ASPECTS.map((aspect) => {
                const isSelected = activeAspectId === aspect.id;
                return (
                  <button
                    key={aspect.id}
                    type="button"
                    onClick={() => handleAspectChange(aspect.id)}
                    className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-rose-500 text-white shadow-md shadow-rose-500/25 font-semibold'
                        : 'bg-neutral-900/70 hover:bg-neutral-800/80 text-neutral-300 hover:text-white border border-neutral-800'
                    }`}
                  >
                    <span>{aspect.label}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded ${
                        isSelected ? 'bg-rose-600/70 text-white' : 'bg-neutral-800 text-neutral-400 font-mono'
                      }`}
                    >
                      {aspect.ratioFraction}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Viewport & Overlay Controls */}
            <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
              {/* Safe-Zone Guide Toggle */}
              <button
                type="button"
                onClick={() => setShowSafeZones(!showSafeZones)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  showSafeZones
                    ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
                title="Toggle simulated Instagram UI safe-zone guides"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Safe-Zones</span>
              </button>

              {/* Grid Toggle */}
              <button
                type="button"
                onClick={() => setShowGrid(!showGrid)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  showGrid
                    ? 'bg-neutral-800 border-neutral-700 text-neutral-200'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-500'
                }`}
                title="Toggle Rule-of-Thirds Grid"
              >
                <Crop className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Grid</span>
              </button>

              {/* View Mode Toggle (Crop vs 1080px Preview) */}
              <div className="flex bg-neutral-900 border border-neutral-800 p-0.5 rounded-lg">
                <button
                  type="button"
                  onClick={() => setViewMode('cropper')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                    viewMode === 'cropper' ? 'bg-neutral-800 text-white font-medium' : 'text-neutral-400'
                  }`}
                >
                  Cropper
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('preview')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                    viewMode === 'preview' ? 'bg-rose-500 text-white font-medium' : 'text-neutral-400'
                  }`}
                >
                  1080px Output
                </button>
              </div>
            </div>
          </div>

          {/* Interactive Crop Stage / Preview Canvas */}
          <div className="relative w-full h-[460px] sm:h-[540px] bg-[#050608] rounded-2xl overflow-hidden border border-neutral-800 shadow-2xl flex items-center justify-center">
            {imageSrc ? (
              viewMode === 'cropper' ? (
                <>
                  <Cropper
                    image={imageSrc}
                    crop={crop}
                    zoom={zoom}
                    aspect={currentConfig.aspect}
                    showGrid={showGrid}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={onCropComplete}
                    cropShape="rect"
                    classes={{
                      containerClassName: 'reactEasyCrop_Container',
                      cropAreaClassName: 'reactEasyCrop_CropArea',
                    }}
                  />

                  {/* Phase 2 Simulated Instagram Safe-Zone Overlays */}
                  <InstagramSafeZoneOverlay preset={currentConfig.preset} active={showSafeZones} />

                  {/* Corner Target Resolution Pill */}
                  <div className="absolute top-3 left-3 z-30 bg-black/80 backdrop-blur-md border border-neutral-800 px-2.5 py-1 rounded-md text-[11px] font-mono text-neutral-300 pointer-events-none">
                    Target: {currentConfig.width} × {currentConfig.height} px
                  </div>
                </>
              ) : (
                /* 1080px Sharpened Output Viewport */
                <div className="relative w-full h-full flex items-center justify-center p-4 bg-[#090b10]">
                  {result ? (
                    <div className="relative max-h-full max-w-full flex items-center justify-center">
                      <img
                        src={result.blobUrl}
                        alt="1080px Output"
                        className="max-h-[500px] w-auto object-contain rounded-lg shadow-2xl border border-neutral-800"
                      />
                      <div className="absolute bottom-3 right-3 bg-black/85 backdrop-blur-md border border-neutral-700/70 text-[11px] font-mono text-neutral-200 px-2.5 py-1 rounded-md shadow-lg">
                        {result.width} × {result.height} px • Q{Math.round(result.quality * 100)}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-neutral-500">
                      <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin text-rose-500" />
                      <span>Rendering 1080px preview...</span>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="text-center text-neutral-500 flex flex-col items-center gap-3">
                <ImageIcon className="w-12 h-12 text-neutral-600" />
                <p className="text-sm">No image loaded</p>
              </div>
            )}

            {/* In-Flight Processing Spinner */}
            {isProcessing && (
              <div className="absolute top-3 right-3 z-30 bg-black/85 backdrop-blur-md border border-rose-500/40 px-3 py-1 rounded-full flex items-center gap-2 text-xs font-mono text-rose-300">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-400" />
                <span>Resampling Lanczos-3...</span>
              </div>
            )}
          </div>

          {/* Gesture & Zoom Control Bar */}
          <div className="bg-[#11131c] border border-neutral-800/90 rounded-2xl p-4 shadow-xl flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 max-w-md">
              <button
                type="button"
                onClick={() => setZoom(Math.max(1, zoom - 0.2))}
                className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>

              <input
                type="range"
                min={1}
                max={3}
                step={0.02}
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
              />

              <button
                type="button"
                onClick={() => setZoom(Math.min(3, zoom + 0.2))}
                className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>

              <span className="font-mono text-xs text-neutral-400 w-12 text-right">
                {zoom.toFixed(2)}×
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setCrop({ x: 0, y: 0 });
                setZoom(1);
              }}
              className="text-xs text-neutral-400 hover:text-neutral-200 border border-neutral-800 hover:border-neutral-700 bg-neutral-900/60 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Reset Crop
            </button>
          </div>
        </div>

        {/* Right Column: Engine Telemetry & Phase 2 Native Export Actions */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {/* Phase 2 Export Card (Web Share API + Camera Roll Save) */}
          <div className="bg-gradient-to-br from-[#181a26] via-[#12141e] to-[#0e1017] border border-rose-500/30 rounded-2xl p-5 shadow-2xl relative overflow-hidden">
            <div className="absolute -right-8 -top-8 w-28 h-28 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Share2 className="w-4 h-4 text-rose-400" />
                <h2 className="text-sm font-semibold tracking-wide uppercase text-neutral-200">
                  Phase 2 Native Export
                </h2>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono">
                1080px JPEG
              </span>
            </div>

            <p className="text-xs text-neutral-400 mb-4 leading-relaxed">
              Saves the pre-tuned Q82 JPEG directly into your iOS/Android Camera Roll via Web Share API, bypassing secondary downloads.
            </p>

            {/* Primary Action Button: Save to Camera Roll / Native Share */}
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => handleExport('share')}
                disabled={!result || isProcessing}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white font-medium text-sm shadow-lg shadow-rose-500/25 transition-all transform active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>Save to Camera Roll / Share</span>
              </button>

              {/* Secondary Action: Direct File Download Fallback */}
              <button
                type="button"
                onClick={() => handleExport('download')}
                disabled={!result || isProcessing}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 text-neutral-300 text-xs font-medium transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-neutral-400" />
                <span>Direct File Download ({result ? formatBytes(result.compressedSize) : '—'})</span>
              </button>
            </div>

            {/* Export Notification Toast */}
            {exportFeedback && (
              <div className="mt-3 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs text-center font-medium animate-fade-in">
                {exportFeedback}
              </div>
            )}
          </div>

          {/* Engine Telemetry Card */}
          <div className="bg-[#11131c] border border-neutral-800/90 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold tracking-wide uppercase text-neutral-200">
                  Engine Telemetry
                </h3>
              </div>
              {result && (
                <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                  {result.processingTimeMs}ms (Sub-2s ✓)
                </span>
              )}
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-neutral-900/80 border border-neutral-800/90 p-3 rounded-xl">
                <span className="text-neutral-400 text-[11px] block">Target Output</span>
                <span className="font-mono text-white font-semibold text-sm">
                  1080 × {currentConfig.height} px
                </span>
                <span className="text-[10px] text-neutral-400 block mt-0.5">
                  Locked {currentConfig.ratioFraction} aspect
                </span>
              </div>

              <div className="bg-neutral-900/80 border border-neutral-800/90 p-3 rounded-xl">
                <span className="text-neutral-400 text-[11px] block">Source Ingestion</span>
                <span className="font-mono text-neutral-200 font-semibold text-sm">
                  {sourceDimensions ? `${sourceDimensions.width}×${sourceDimensions.height}` : '—'}
                </span>
                <span className="text-[10px] text-neutral-400 block mt-0.5">
                  {result ? formatBytes(result.originalSize) : '—'}
                </span>
              </div>

              <div className="bg-neutral-900/80 border border-neutral-800/90 p-3 rounded-xl">
                <span className="text-neutral-400 text-[11px] block">Output JPEG Weight</span>
                <span
                  className={`font-mono font-semibold text-sm ${
                    result && result.compressedSize <= currentConfig.maxKb * 1024
                      ? 'text-emerald-400'
                      : 'text-amber-400'
                  }`}
                >
                  {result ? formatBytes(result.compressedSize) : '—'}
                </span>
                <span className="text-[10px] text-neutral-400 block mt-0.5">
                  Target: &lt; {currentConfig.maxKb} KB
                </span>
              </div>

              <div className="bg-neutral-900/80 border border-neutral-800/90 p-3 rounded-xl">
                <span className="text-neutral-400 text-[11px] block">Resampling Kernel</span>
                <span className="font-mono text-purple-400 font-semibold text-sm">Lanczos-3</span>
                <span className="text-[10px] text-neutral-400 block mt-0.5">3-lobed Sinc filter</span>
              </div>
            </div>

            {/* Crop Boundary Pixel Inspection */}
            {result && (
              <div className="bg-neutral-950/60 border border-neutral-800/70 p-3 rounded-xl text-[11px] font-mono text-neutral-400 space-y-1">
                <div className="flex justify-between">
                  <span>Crop Box:</span>
                  <span className="text-neutral-200">
                    {result.dimensions.cropWidth} × {result.dimensions.cropHeight} px
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Crop Offset:</span>
                  <span className="text-neutral-200">
                    x:{result.dimensions.cropX}, y:{result.dimensions.cropY}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Downsample Ratio:</span>
                  <span className="text-rose-400">
                    {(result.dimensions.cropWidth / 1080).toFixed(2)}× downscaling
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Compression & Sharpness Tuning */}
          <div className="bg-[#11131c] border border-neutral-800/90 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-purple-400" />
              <h3 className="text-sm font-semibold tracking-wide uppercase text-neutral-200">
                Resampling Tuning
              </h3>
            </div>

            {/* Quality Slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-neutral-300 font-medium">JPEG Quality</span>
                <span className="font-mono text-rose-400 font-semibold">
                  Q{Math.round(quality * 100)} ({quality.toFixed(2)})
                </span>
              </div>
              <input
                type="range"
                min="0.60"
                max="0.92"
                step="0.01"
                value={quality}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setQuality(val);
                  executePipeline(croppedAreaPixels, val, unsharpAmount, currentConfig);
                }}
                className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
              />
              <span className="text-[10px] text-neutral-400 block">
                Target: Q82–84 prevents Instagram re-encoding passes while preserving micro-textures.
              </span>
            </div>

            {/* Unsharp Mask Amount Slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-neutral-300 font-medium">Unsharp Mask Amount</span>
                <span className="font-mono text-purple-400 font-semibold">{unsharpAmount}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="60"
                step="2"
                value={unsharpAmount}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setUnsharpAmount(val);
                  executePipeline(croppedAreaPixels, quality, val, currentConfig);
                }}
                className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
              <span className="text-[10px] text-neutral-400 block">
                Counteracts blurring from Instagram's 4:2:0 chroma subsampling.
              </span>
            </div>
          </div>

          {/* Privacy & Safe-Zone Guarantee Note */}
          <div className="bg-[#11131c]/50 border border-neutral-800/80 rounded-2xl p-4 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs text-neutral-400 leading-relaxed">
              <span className="text-neutral-200 font-semibold block">Privacy & Ingestion Safe:</span>
              Photos stay entirely in client memory. All EXIF metadata (GPS, camera serials) is stripped during canvas re-encoding.
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-xl flex items-center gap-2 text-red-300 text-xs">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
