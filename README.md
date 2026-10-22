# Instagram Image Optimizer 🚀

> **Client-Side WebAssembly Image Resampling & Ingestion Engine**  
> Eliminates social media transcoding artifacts through deterministic downsampling, sRGB gamut mapping, and screen-targeted unsharp masking directly in the browser.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-insta--optimizer.vercel.app-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://insta-optimizer.vercel.app/)

[![React](https://img.shields.io/badge/React-19.3-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-4.3-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-MozJPEG-654FF0?logo=webassembly&logoColor=white)](https://webassembly.org)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Client--Side-10B981)](#-zero-latency--zero-server-data-boundary)

---

### 🌐 Live Production Application
Experience the optimizer directly on your desktop or mobile device (iPhone/Android camera rolls supported):  
👉 **[https://insta-optimizer.vercel.app/](https://insta-optimizer.vercel.app/)**

---

## 📸 The Problem It Solves

When high-resolution photos ($24\text{ MP}$ to $60\text{ MP}$, $>10\text{ MB}$) are uploaded to Instagram directly, Meta's ingestion pipeline executes **crude bilinear downsampling** and **heavy MozJPEG re-quantization**. This causes:
- Loss of fine micro-contrast and facial textures.
- Noticeable ringing halos and step-aliasing along high-frequency edges.
- Color desaturation from unmanaged Display-P3 gamut stripping.
- Awkward letterbox borders when aspect ratios deviate from Meta's strict dimensions.

**This optimizer neutralizes transcoding artifacts by performing deterministic, studio-grade processing entirely in user RAM before upload.**

---

## ⚡ Key Architectural Features

### 1. 3-Lobed Lanczos-3 Resampling
Executes Sinc-windowed filter matrices ($L(x) = \text{sinc}(x)\text{sinc}(x/3)$) via **Pica.js** running off-thread in dedicated Web Workers. Preserves razor-sharp transitions without introducing edge halos or bilinear blur.

### 2. Standard sRGB IEC 61966-2.1 Color Gamut
Enforces hardware-accelerated sRGB 8-bit color space transformation via Canvas 2D contexts, preventing color shifting on non-OLED and standard sRGB screens.

### 3. Progressive MozJPEG WebAssembly Encoding
WebAssembly-compiled **MozJPEG** applies progressive scan sorting and rate-distortion trellis quantization. Produces deterministic Q82 JPEGs ($<600\text{ KB}$) that completely **bypass Instagram's backend re-compression passes**.

### 4. Native iPhone HEIC/HEIF Dynamic Ingestion
iPhone camera rolls default to Apple's `.heic`/`.heif` container. The engine dynamically lazy-loads `heic2any` on demand, transcoding high-efficiency camera captures into standard sRGB JPEGs without inflating the initial web bundle.

### 5. Instagram Safe-Zone Overlays & Touch Cropping
Interactive viewport locked to Instagram container targets ($4:5$, $1:1$, $1.91:1$, $9:16$) with touch-action safety and real-time SVG simulated overlays representing Instagram's profile headers, action bars, and stories danger zones.

### 6. Visual "Hold to Compare" Delta Inspector
Allows creators to press and hold to swap between the unsharpened reference crop and the sharpened Lanczos-3 output, providing instantaneous visual verification of micro-contrast retention.

### 7. Native Mobile Share Sheet Export
Utilizes the W3C Web Share API (`navigator.share({ files: [file] })`) on iOS Safari and Android Chrome to save the optimized file directly to the **Photos Camera Roll** in one tap, with automatic fallback to file downloads on desktop browsers.

---

## 📐 Instagram Container Profile Target Matrix

| Preset | Aspect Ratio | Target Dimensions | Target Weight | Ingestion Optimization |
| :--- | :--- | :--- | :--- | :--- |
| **Feed Portrait** *(Default)* | $4:5$ ($0.80$) | **$1080 \times 1350\text{ px}$** | $400\text{–}600\text{ KB}$ | Bypasses server bilinear crop; max mobile feed engagement. |
| **Feed Square** | $1:1$ ($1.00$) | **$1080 \times 1080\text{ px}$** | $350\text{–}500\text{ KB}$ | Classic grid standard; zero letterboxing. |
| **Feed Landscape** | $1.91:1$ ($1.91$) | **$1080 \times 566\text{ px}$** | $250\text{–}400\text{ KB}$ | Prevents automatic horizontal border padding. |
| **Stories & Reels** | $9:16$ ($0.562$) | **$1080 \times 1920\text{ px}$** | $500\text{–}750\text{ KB}$ | Full vertical screen; bypasses story video/photo transcode. |

---

## 🔒 Zero-Latency & Zero-Server Data Boundary

- **No Remote Network Upload**: Images are never uploaded to any remote server or external API.
- **GDPR & Privacy Native**: All computation occurs inside browser memory (`OffscreenCanvas`, Web Workers, and WebAssembly).
- **Automatic EXIF Sanitization**: Re-encoding strips GPS coordinates, camera serial numbers, and personal metadata prior to export.
- **Client Memory Guards**: Downscales captures $>64\text{ MP}$ prior to kernel allocation, protecting mobile browsers against memory crashes.

---

## 🛠️ Project Structure

```text
├── public/
│   ├── _headers                    # Cloudflare Pages COOP/COEP isolation headers
│   └── favicon.svg                 # Application favicon
├── src/
│   ├── components/
│   │   └── InstagramSafeZoneOverlay.tsx # Simulated IG UI safe-zones
│   ├── engine/
│   │   └── pipeline.ts             # Core Lanczos-3 & MozJPEG Wasm pipeline
│   ├── types/
│   │   └── heic2any.d.ts           # Type definitions for lazy HEIC loader
│   ├── App.tsx                     # Main interactive mobile-first studio UI
│   ├── index.css                   # Tailwind CSS v4 styling & dark theme
│   └── main.tsx                    # React application entry point
├── scripts/
│   ├── test-mobile-export.mjs      # Puppeteer headless mobile export verification
│   └── test-phase4-verification.mjs # Full Phase 4 verification test suite
├── vercel.json                     # Vercel deployment headers
├── vite.config.ts                  # Vite manual code-splitting configuration
└── ARCHITECTURE.md                 # System technical specifications
```

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) `>= 20.0.0`
- [npm](https://www.npmjs.com/) `>= 10.0.0`

### Installation
```bash
# Clone the repository
git clone https://github.com/vaibhavdhanaliya14/Image_Compressor.git
cd Image_Compressor

# Install dependencies
npm install
```

### Development
```bash
# Start Vite development server
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### Production Build
```bash
# Run TypeScript check and Vite production build
npm run build

# Preview production build locally
npm run preview
```

### Automated Mobile Verification Suite
```bash
# Run headless browser mobile verification (iPhone 14 emulation)
node scripts/test-phase4-verification.mjs
```

---

## 🌐 Deployment

The project is static-edge ready with zero backend requirements:

- **Cloudflare Pages**: Deploys automatically with `public/_headers` providing `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
- **Vercel**: Pre-configured via `vercel.json` with identical cross-origin isolation headers.

---

## 📄 License

MIT © [vaibhavdhanaliya14](https://github.com/vaibhavdhanaliya14)
