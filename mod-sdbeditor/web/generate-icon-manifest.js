import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const iconsDir = path.join(__dirname, 'public', 'INT_335_wotlk', 'Icons');
const outputFile = path.join(__dirname, 'public', 'base-icons-manifest.json');

console.log('Scanning base icons folder...');
console.log('Path:', iconsDir);

const files = fs.readdirSync(iconsDir);
const blpFiles = files
  .filter(f => f.toLowerCase().endsWith('.blp'))
  .map(f => f.replace(/\.blp$/i, '')) // Remove .blp extension
  .sort();

console.log(`Found ${blpFiles.length} BLP files`);

const manifest = {
  generated: new Date().toISOString(),
  source: 'INT_335_wotlk/Icons',
  count: blpFiles.length,
  icons: blpFiles
};

fs.writeFileSync(outputFile, JSON.stringify(manifest, null, 2));

console.log(`✓ Manifest saved to: ${outputFile}`);
console.log(`✓ Total base icons: ${blpFiles.length}`);
