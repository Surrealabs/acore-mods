import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { BLPFile } from './src/lib/blpconverter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const THUMBNAILS_DIR = path.join(PUBLIC_DIR, 'thumbnails');
const ICON_DIR = path.join(PUBLIC_DIR, 'Icons');

let watcherActive = false;
let processingQueue = new Set();

async function ensureThumbnailsDir() {
  if (!fs.existsSync(THUMBNAILS_DIR)) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
  }
}

async function generateThumbnailForFile(blpFilePath) {
  const fileName = path.basename(blpFilePath);
  const thumbnailPath = path.join(THUMBNAILS_DIR, fileName.replace(/\.blp$/i, '.png'));
  
  // Skip if already processing or thumbnail exists
  if (processingQueue.has(fileName) || fs.existsSync(thumbnailPath)) {
    return;
  }

  processingQueue.add(fileName);
  
  try {
    const blpData = fs.readFileSync(blpFilePath);
    const blp = new BLPFile(new Uint8Array(blpData));
    const pixels = blp.getPixels(0);
    const rgba = pixels?.buffer ? new Uint8Array(pixels.buffer) : new Uint8Array(pixels);
    
    const buffer = await sharp(rgba, {
      raw: {
        width: blp.width,
        height: blp.height,
        channels: 4
      }
    })
    .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

    fs.writeFileSync(thumbnailPath, buffer);
    console.log(`✓ Generated thumbnail: ${fileName}`);
  } catch (err) {
    console.error(`✗ Failed to generate thumbnail for ${fileName}:`, err.message);
  } finally {
    processingQueue.delete(fileName);
  }
}

export function startThumbnailWatcher() {
  if (watcherActive) {
    console.log('Thumbnail watcher already active');
    return;
  }

  ensureThumbnailsDir();

  if (!fs.existsSync(ICON_DIR)) {
    console.log(`Icon directory not found: ${ICON_DIR}`);
    return;
  }

  console.log(`Starting thumbnail watcher on: ${ICON_DIR}`);
  
  // Watch for new BLP files
  const watcher = fs.watch(ICON_DIR, { recursive: false }, async (eventType, filename) => {
    if (!filename || !filename.toLowerCase().endsWith('.blp')) return;
    
    const filePath = path.join(ICON_DIR, filename);
    
    // Give the file a moment to finish writing
    setTimeout(async () => {
      if (fs.existsSync(filePath)) {
        console.log(`New BLP detected: ${filename}`);
        await generateThumbnailForFile(filePath);
      }
    }, 500);
  });

  watcherActive = true;
  console.log('✓ Thumbnail watcher active - will auto-generate thumbnails for new BLP files');

  return watcher;
}

export function stopThumbnailWatcher() {
  watcherActive = false;
  console.log('Thumbnail watcher stopped');
}
