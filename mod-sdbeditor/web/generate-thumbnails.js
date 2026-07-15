#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { BLPFile } from './src/lib/blpconverter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const THUMBNAILS_DIR = path.join(PUBLIC_DIR, 'thumbnails');
const ICON_DIR = path.join(PUBLIC_DIR, 'Icons');

async function generateThumbnails() {
  console.log('Starting thumbnail generation...');
  
  // Ensure thumbnails directory exists
  if (!fs.existsSync(THUMBNAILS_DIR)) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
    console.log('Created thumbnails directory');
  }

  if (!fs.existsSync(ICON_DIR)) {
    console.error(`Icon directory not found: ${ICON_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(ICON_DIR).filter(f => f.toLowerCase().endsWith('.blp'));
  console.log(`Found ${files.length} BLP files to process`);

  let generated = 0, skipped = 0, failed = 0;

  for (const file of files) {
    try {
      const iconPath = path.join(ICON_DIR, file);
      const thumbnailPath = path.join(THUMBNAILS_DIR, file.replace(/\.blp$/i, '.png'));
      
      // Skip if thumbnail already exists
      if (fs.existsSync(thumbnailPath)) {
        skipped++;
        if (skipped % 100 === 0) {
          console.log(`Progress: ${generated} generated, ${skipped} skipped, ${failed} failed`);
        }
        continue;
      }

      // Read and decode BLP file
      const blpData = fs.readFileSync(iconPath);
      const blp = new BLPFile(new Uint8Array(blpData));
      const pixels = blp.getPixels(0);
      
      // Get RGBA pixel data
      const rgba = pixels?.buffer ? new Uint8Array(pixels.buffer) : new Uint8Array(pixels);
      
      // Convert RGBA to PNG using Sharp
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
      generated++;
      
      if (generated % 100 === 0) {
        console.log(`Progress: ${generated} generated, ${skipped} skipped, ${failed} failed`);
      }
    } catch (err) {
      console.error(`Failed to generate thumbnail for ${file}:`, err.message);
      failed++;
    }
  }

  console.log(`\n✅ Thumbnail generation complete!`);
  console.log(`   Generated: ${generated}`);
  console.log(`   Skipped (already exists): ${skipped}`);
  console.log(`   Failed: ${failed}`);
  console.log(`\nThumbnails saved to: ${THUMBNAILS_DIR}`);
}

generateThumbnails().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
