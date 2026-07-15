import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BLPFile } from './src/lib/blpconverter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const THUMBNAILS_DIR = path.join(PUBLIC_DIR, 'thumbnails');
const ICON_LIST_PATH = path.join(PUBLIC_DIR, 'icon-list.json');

/**
 * Load SpellIcon.dbc and extract ID -> filename mappings
 */
function loadIconDbcMappings(dbcPath) {
  try {
    if (!fs.existsSync(dbcPath)) {
      return new Map(); // Return empty map if no DBC yet
    }

    const buffer = fs.readFileSync(dbcPath);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let offset = 0;

    // Read DBC header
    const signature = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    offset += 4;

    if (signature !== 'WDBC') {
      console.warn('Invalid DBC signature');
      return new Map();
    }

    const recordCount = view.getUint32(offset, true);
    offset += 4;
    const fieldCount = view.getUint32(offset, true);
    offset += 4;
    const fieldSize = view.getUint32(offset, true);
    offset += 4;
    const stringBlockSize = view.getUint32(offset, true);
    offset += 4;

    // Read records (ID is field_0, path string offset is field_1)
    const recordsStart = offset;
    const stringBlockStart = recordsStart + recordCount * fieldSize;
    const stringBlock = buffer.slice(stringBlockStart, stringBlockStart + stringBlockSize);
    const stringBlockText = new TextDecoder().decode(stringBlock);

    const mappings = new Map(); // ID -> filename

    for (let i = 0; i < recordCount; i++) {
      const recordOffset = recordsStart + i * fieldSize;
      const id = view.getUint32(recordOffset, true); // field_0
      const pathOffset = view.getUint32(recordOffset + 4, true); // field_1

      // Extract string from string block
      let pathEnd = pathOffset;
      while (
        pathEnd < stringBlockText.length &&
        stringBlockText.charCodeAt(pathEnd) !== 0
      ) {
        pathEnd++;
      }

      const iconPath = stringBlockText.substring(pathOffset, pathEnd);
      if (iconPath) {
        mappings.set(id, iconPath);
      }
    }

    return mappings;
  } catch (err) {
    console.error(`Error loading DBC mappings: ${err.message}`);
    return new Map();
  }
}

function normalizeIconName(input) {
  if (!input) return '';
  let name = String(input).replace(/\\/g, '/');
  if (name.includes('/')) name = name.substring(name.lastIndexOf('/') + 1);
  name = name.toLowerCase();
  name = name.replace(/\.blp$/i, '');
  return name.trim();
}

function normalizeIconList(list) {
  return list
    .filter(name => typeof name === 'string')
    .map(name => name.trim())
    .filter(name => name.length > 0)
    .sort((a, b) => a.localeCompare(b));
}

export function loadOrBuildIconList(iconDirPath) {
  try {
    if (fs.existsSync(ICON_LIST_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(ICON_LIST_PATH, 'utf8'));
      if (Array.isArray(parsed?.files)) {
        return normalizeIconList(parsed.files);
      }
    }
  } catch (err) {
    console.warn(`Icon list cache load failed: ${err.message}`);
  }

  if (!fs.existsSync(iconDirPath)) return [];
  const files = fs.readdirSync(iconDirPath).filter(f => f.toLowerCase().endsWith('.blp'));
  const normalized = normalizeIconList(files);
  saveIconList(normalized);
  return normalized;
}

export function saveIconList(files) {
  try {
    const payload = {
      generated: new Date().toISOString(),
      count: files.length,
      files,
    };
    fs.writeFileSync(ICON_LIST_PATH, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.warn(`Failed to write icon list cache: ${err.message}`);
  }
}

/**
 * Generate icon manifest with thumbnail status and DBC mappings
 */
export async function generateIconManifest(iconDirPath, customDbcPath, iconList = null) {
  try {
    console.log('Generating icon manifest...');

    // Load DBC mappings
    const dbcMappings = loadIconDbcMappings(customDbcPath);

    // Scan icon directory
    if (!fs.existsSync(iconDirPath)) {
      console.log(`Icon directory not found: ${iconDirPath}`);
      return null;
    }

    const files = Array.isArray(iconList)
      ? iconList
      : fs.readdirSync(iconDirPath).filter(f => f.toLowerCase().endsWith('.blp'));

    // Build normalized path -> ID index once (avoids O(n^2) scans)
    const dbcPathToId = new Map();
    for (const [dbcId, dbcPath] of dbcMappings) {
      const key = normalizeIconName(dbcPath);
      if (key && !dbcPathToId.has(key)) {
        dbcPathToId.set(key, dbcId);
      }
    }

    const icons = [];

    for (const file of files) {
      const thumbnailPath = path.join(THUMBNAILS_DIR, file.replace(/\.blp$/i, '.png'));
      const thumbnail = fs.existsSync(thumbnailPath)
        && fs.statSync(thumbnailPath).size > 0;

      // Find ID in DBC via normalized index
      const fileKey = normalizeIconName(file);
      const id = dbcPathToId.has(fileKey) ? dbcPathToId.get(fileKey) : null;

      icons.push({
        id,
        name: file,
        thumbnail,
        inDbc: id !== null
      });
    }

    // Sort by name for consistent output
    icons.sort((a, b) => a.name.localeCompare(b.name));

    const manifest = {
      generated: new Date().toISOString(),
      count: icons.length,
      withThumbnails: icons.filter(i => i.thumbnail).length,
      inDbc: icons.filter(i => i.inDbc).length,
      icons
    };

    return manifest;
  } catch (err) {
    console.error(`Error generating manifest: ${err.message}`);
    return null;
  }
}

/**
 * Save manifest to file
 */
export function saveManifest(manifest, outputPath) {
  try {
    if (!manifest) return false;
    const manifestPath = outputPath || path.join(PUBLIC_DIR, 'icon-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`✓ Manifest saved: ${manifest.count} icons, ${manifest.withThumbnails} with thumbnails, ${manifest.inDbc} in DBC`);
    return true;
  } catch (err) {
    console.error(`Error saving manifest: ${err.message}`);
    return false;
  }
}

/**
 * Get missing thumbnails
 */
export function getMissingThumbnails(manifest) {
  if (!manifest) return [];
  return manifest.icons
    .filter(icon => !icon.thumbnail)
    .map(icon => icon.name);
}

/**
 * Generate missing thumbnails from BLP files
 */
export async function generateMissingThumbnails(iconDirPath) {
  try {
    const baseIconCandidates = [
      path.join(PUBLIC_DIR, 'icon'),
      path.join(PUBLIC_DIR, 'Icon'),
      path.join(PUBLIC_DIR, 'Icons'),
    ];
    const baseIconPath = baseIconCandidates.find(p => fs.existsSync(p)) || null;
    const exportDbcPath = path.join(__dirname, '..', 'export', 'DBFilesClient', 'SpellIcon.dbc');
    const baseDbcPath = path.join(PUBLIC_DIR, 'dbc', 'SpellIcon.dbc');
    const dbcPath = fs.existsSync(exportDbcPath) ? exportDbcPath : baseDbcPath;
    const manifest = await generateIconManifest(iconDirPath, dbcPath);
    if (!manifest) return { generated: 0, failed: 0 };

    const missing = getMissingThumbnails(manifest);
    console.log(`Found ${missing.length} icons missing thumbnails`);

    let generated = 0;
    let failed = 0;

    for (const file of missing) {
      try {
        const sharp = (await import('sharp')).default;
        const blpPath = path.join(iconDirPath, file);
        let sourcePath = blpPath;
        let sourceStats = fs.existsSync(sourcePath) ? fs.statSync(sourcePath) : null;
        if (!sourceStats || sourceStats.size === 0) {
          if (baseIconPath) {
            const fallbackPath = path.join(baseIconPath, file);
            if (fs.existsSync(fallbackPath) && fs.statSync(fallbackPath).size > 0) {
              sourcePath = fallbackPath;
              sourceStats = fs.statSync(sourcePath);
            }
          }
        }

        if (!sourceStats || sourceStats.size === 0) {
          throw new Error('BLP file is empty or missing');
        }

        const thumbPath = path.join(THUMBNAILS_DIR, file.replace(/\.blp$/i, '.png'));

        const blpData = fs.readFileSync(sourcePath);
        const blp = new BLPFile(new Uint8Array(blpData));
        const pixels = blp.getPixels(0);
        const rgba = pixels?.buffer ? new Uint8Array(pixels.buffer) : new Uint8Array(pixels);

        const buffer = await sharp(rgba, {
          raw: { width: blp.width, height: blp.height, channels: 4 }
        })
          .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();

        fs.writeFileSync(thumbPath, buffer);
        console.log(`✓ Generated thumbnail: ${file}`);
        generated++;
      } catch (err) {
        console.error(`✗ Failed thumbnail: ${file} - ${err.message}`);
        failed++;
      }
    }

    console.log(`Thumbnail generation: ${generated} generated, ${failed} failed`);
    return { generated, failed };
  } catch (err) {
    console.error(`Error generating thumbnails: ${err.message}`);
    return { generated: 0, failed: 0 };
  }
}

/**
 * Full manifest update cycle with thumbnail generation
 */
export async function updateFullManifest(iconDirPath, customDbcPath, options = {}) {
  try {
    console.log('🔄 Starting full manifest update...');

    const { iconList, skipThumbnails } = options;
    const thumbResult = skipThumbnails
      ? { generated: 0, failed: 0 }
      : await generateMissingThumbnails(iconDirPath);

    // Generate manifest
    const manifest = await generateIconManifest(iconDirPath, customDbcPath, iconList);

    // Save to file
    const saved = saveManifest(manifest, path.join(PUBLIC_DIR, 'icon-manifest.json'));

    if (saved) {
      console.log(`✅ Manifest update complete! (${thumbResult.generated} thumbnails, ${thumbResult.failed} failed)`);
      return { success: true, manifest, ...thumbResult };
    } else {
      console.error('❌ Failed to save manifest');
      return { success: false, ...thumbResult };
    }
  } catch (err) {
    console.error(`Error in full manifest update: ${err.message}`);
    return { success: false, generated: 0, failed: 0 };
  }
}
