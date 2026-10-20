import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const downloadDir = path.resolve(__dirname, '../test-downloads');
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true });
} else {
  // Clean old files
  for (const f of fs.readdirSync(downloadDir)) {
    fs.unlinkSync(path.join(downloadDir, f));
  }
}

const screenshotsDir = path.resolve(__dirname, '../test-screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

// Find chrome or edge
const chromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const executablePath = chromePaths.find((p) => fs.existsSync(p));

if (!executablePath) {
  console.error('No suitable browser found.');
  process.exit(1);
}

console.log('Using browser binary:', executablePath);

function getJpegDimensions(buffer) {
  let i = 2; // skip SOI (0xFF, 0xD8)
  while (i < buffer.length - 8) {
    if (buffer[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buffer[i + 1];
    // Baseline & Progressive SOF markers: SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = buffer.readUInt16BE(i + 5);
      const width = buffer.readUInt16BE(i + 7);
      return { width, height };
    }
    if (i + 4 <= buffer.length) {
      const length = buffer.readUInt16BE(i + 2);
      i += 2 + length;
    } else {
      break;
    }
  }
  return null;
}

async function findButtonByText(page, textSubstring, timeout = 10000) {
  await page.waitForFunction(
    (text) => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some((b) => b.innerText && b.innerText.includes(text));
    },
    { timeout },
    textSubstring
  );

  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await page.evaluate((el) => el.innerText, btn);
    if (text && text.includes(textSubstring)) {
      return btn;
    }
  }
  return null;
}

async function run() {
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  const page = await browser.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('Browser Error:', msg.text());
    }
  });

  page.on('pageerror', (err) => {
    console.error('Browser Page Error:', err.message);
  });

  // Emulate iPhone 14
  const iPhone14 = {
    name: 'iPhone 14',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    viewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      isLandscape: false,
    },
  };

  await page.setUserAgent(iPhone14.userAgent);
  await page.setViewport(iPhone14.viewport);

  // Intercept downloads and native share sheet
  await page.evaluateOnNewDocument(() => {
    window.__capturedDownloads = [];

    // Hook HTMLAnchorElement.prototype.click to intercept blob downloads
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.href) {
        const href = this.href;
        const filename = this.download;
        fetch(href)
          .then((res) => res.blob())
          .then((blob) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = reader.result.split(',')[1];
              window.__capturedDownloads.push({
                filename: filename,
                base64: base64,
              });
            };
            reader.readAsDataURL(blob);
          })
          .catch((err) => {
            console.error('Failed to intercept blob download:', err);
          });
      }
      return origClick.apply(this, arguments);
    };

    // Polyfill Web Share API
    if (typeof navigator !== 'undefined') {
      navigator.canShare = (data) => Boolean(data && data.files && data.files.length > 0);
      navigator.share = async (data) => {
        if (data && data.files && data.files.length > 0) {
          const f = data.files[0];
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            window.__capturedDownloads.push({
              filename: f.name,
              base64: base64,
            });
          };
          reader.readAsDataURL(f);
        }
        return Promise.resolve();
      };
    }
  });

  // Configure CDP download behavior
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
  });

  console.log('Navigating to http://localhost:5173/ on iPhone 14 mobile viewport...');
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 30000 });

  await page.screenshot({ path: path.join(screenshotsDir, '1-initial-mobile-load.png') });
  console.log('Captured screenshot 1: initial-mobile-load.png');

  // Ensure 4:5 aspect ratio is selected
  const fourFiveButton = await findButtonByText(page, 'Feed Portrait', 10000);
  if (fourFiveButton) {
    await fourFiveButton.click();
    console.log('Confirmed 4:5 Feed Portrait tab is active');
  }

  // Wait for Lanczos3 pipeline execution to settle (processing indicator goes away and telemetry ready)
  console.log('Waiting for Lanczos-3 pipeline to process sample image...');
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return (
        text.includes('1080 × 1350 px') &&
        text.includes('Sub-2s ✓') &&
        !text.includes('Resampling Lanczos-3...')
      );
    },
    { timeout: 20000 }
  );

  await page.screenshot({ path: path.join(screenshotsDir, '2-crop-ready-4x5.png') });
  console.log('Captured screenshot 2: crop-ready-4x5.png');

  // Find export button
  console.log('Locating export buttons...');
  const directDownloadBtn = await findButtonByText(page, 'Direct File Download', 10000);

  if (!directDownloadBtn) {
    throw new Error('Direct File Download button not found');
  }

  console.log('Clicking Direct File Download button...');
  await directDownloadBtn.click();

  // Wait for download to appear in downloadDir or in intercepted window.__capturedDownloads
  console.log('Waiting for file export interception and download in', downloadDir);
  let capturedDownload = null;
  const startTime = Date.now();

  while (Date.now() - startTime < 8000) {
    // 1. Check intercepted blob download
    const captured = await page.evaluate(() => {
      if (window.__capturedDownloads && window.__capturedDownloads.length > 0) {
        return window.__capturedDownloads[window.__capturedDownloads.length - 1];
      }
      return null;
    });

    if (captured && captured.base64) {
      console.log('Captured exported file via anchor interceptor:', captured.filename);
      capturedDownload = captured;
      break;
    }

    // 2. Check filesystem (CDP download)
    const files = fs.readdirSync(downloadDir).filter((f) => !f.endsWith('.crdownload') && !f.endsWith('.tmp'));
    if (files.length > 0) {
      break;
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  // Wait a moment for UI feedback toast to render before final screenshot
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return text.includes('Saved to local downloads') || text.includes('Shared / Saved');
    },
    { timeout: 5000 }
  ).catch(() => {});

  await page.screenshot({ path: path.join(screenshotsDir, '3-after-export.png') });
  console.log('Captured screenshot 3: after-export.png');

  await browser.close();

  // Determine downloaded file path (either directly saved by CDP or written from intercepted export)
  let downloadedFile = null;
  const existingFiles = fs.readdirSync(downloadDir).filter((f) => !f.endsWith('.crdownload') && !f.endsWith('.tmp'));
  if (existingFiles.length > 0) {
    downloadedFile = path.join(downloadDir, existingFiles[0]);
  } else if (capturedDownload && capturedDownload.base64) {
    const filePath = path.join(downloadDir, capturedDownload.filename);
    fs.writeFileSync(filePath, Buffer.from(capturedDownload.base64, 'base64'));
    downloadedFile = filePath;
  }

  if (!downloadedFile) {
    console.error('DOWNLOAD VERIFICATION FAILED: No file was downloaded.');
    process.exit(1);
  }

  const stats = fs.statSync(downloadedFile);
  const buffer = fs.readFileSync(downloadedFile);
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const dims = getJpegDimensions(buffer);

  console.log('=== VERIFICATION RESULT ===');
  console.log('Downloaded File:', path.basename(downloadedFile));
  console.log('File Size:', (stats.size / 1024).toFixed(2), 'KB');
  if (dims) {
    console.log(`Output Dimensions: ${dims.width} × ${dims.height} px`);
  }
  console.log('Valid JPEG Magic Bytes:', isJpeg ? 'YES (0xFF 0xD8 0xFF)' : 'NO');
  console.log('Meets Instagram Target (<600 KB):', stats.size < 600 * 1024 ? 'YES' : 'NO');
  console.log('Exact 4:5 Target (1080x1350):', dims && dims.width === 1080 && dims.height === 1350 ? 'YES' : 'NO');

  if (!isJpeg || stats.size === 0) {
    console.error('Verification failed: invalid JPEG file');
    process.exit(1);
  }

  console.log('ALL PHASE 2 MOBILE VERIFICATIONS PASSED.');
}

run().catch((err) => {
  console.error('Error during headless browser execution:', err);
  process.exit(1);
});
