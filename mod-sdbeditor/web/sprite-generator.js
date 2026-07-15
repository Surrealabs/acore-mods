import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const THUMBNAILS_DIR = path.join(__dirname, 'public', 'thumbnails');
const SPRITES_DIR = path.join(__dirname, 'public', 'sprites');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ICON_SIZE = 64;
const ICONS_PER_ROW = 16; // Smaller sheets for per-class sprites

// Import DBC parsing functions
function loadConfigFile() {
  const configPath = path.join(__dirname, 'public', 'config.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  return { paths: { custom: { dbc: 'dbc' } } };
}

function parseTalentDBC(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 20) return [];

    const magic = buffer.toString('utf-8', 0, 4);
    if (magic !== 'WDBC') return [];

    const recordCount = buffer.readUInt32LE(4);
    const recordSize = buffer.readUInt32LE(12);
    const headerSize = 20;
    const recordsOffset = headerSize;
    const talents = [];

    for (let i = 0; i < recordCount; i++) {
      const offset = recordsOffset + (i * recordSize);
      try {
        const id = buffer.readUInt32LE(offset);
        const tabId = buffer.readUInt32LE(offset + 4);
        const tierId = buffer.readUInt32LE(offset + 8);
        const columnIndex = buffer.readUInt32LE(offset + 12);
        const spellId = buffer.readUInt32LE(offset + 16);

        talents.push({ id, tabId, row: tierId, column: columnIndex, spellId });
      } catch (e) {
        // Skip malformed records
      }
    }

    return talents;
  } catch (error) {
    console.error('Error parsing Talent.dbc:', error);
    return [];
  }
}

function getIconForSpell(spellId, dbcDir) {
  const spellPath = path.join(dbcDir, 'Spell.dbc');
  const spellIconPath = path.join(dbcDir, 'SpellIcon.dbc');
  
  if (!fs.existsSync(spellPath) || !fs.existsSync(spellIconPath)) {
    return null;
  }

  try {
    // Load SpellIcon.dbc
    const iconBuffer = fs.readFileSync(spellIconPath);
    const iconView = new DataView(iconBuffer.buffer, iconBuffer.byteOffset, iconBuffer.byteLength);
    const iconRecordCount = iconView.getUint32(4, true);
    const iconRecordSize = iconView.getUint32(12, true);
    const iconStringBlockSize = iconView.getUint32(16, true);
    const iconHeaderSize = 20;
    const iconStringBlockOffset = iconHeaderSize + (iconRecordCount * iconRecordSize);

    const readString = (offset) => {
      if (offset === 0) return '';
      const start = iconStringBlockOffset + offset;
      let end = start;
      while (end < iconBuffer.length && iconBuffer[end] !== 0) end++;
      return iconBuffer.slice(start, end).toString('utf8');
    };

    const spellIconMap = new Map();
    for (let i = 0; i < iconRecordCount; i++) {
      const recordOffset = iconHeaderSize + (i * iconRecordSize);
      const id = iconView.getUint32(recordOffset, true);
      const iconPathOffset = iconView.getUint32(recordOffset + 4, true);
      const iconPath = readString(iconPathOffset);
      spellIconMap.set(id, iconPath);
    }

    // Load Spell.dbc and find spellIconId
    const spellBuffer = fs.readFileSync(spellPath);
    const spellView = new DataView(spellBuffer.buffer, spellBuffer.byteOffset, spellBuffer.byteLength);
    const spellRecordCount = spellView.getUint32(4, true);
    const spellRecordSize = spellView.getUint32(12, true);
    const spellHeaderSize = 20;

    for (let i = 0; i < spellRecordCount; i++) {
      const recordOffset = spellHeaderSize + (i * spellRecordSize);
      const currentSpellId = spellView.getUint32(recordOffset, true);
      if (currentSpellId === spellId) {
        const spellIconId = spellView.getUint32(recordOffset + 532, true);
        let iconPath = spellIconMap.get(spellIconId);
        if (iconPath) {
          iconPath = iconPath.replace(/\\/g, '/');
          if (iconPath.includes('/')) {
            iconPath = iconPath.substring(iconPath.lastIndexOf('/') + 1);
          }
          iconPath = iconPath.replace(/\.[^.]+$/, '');
          return iconPath;
        }
      }
    }
  } catch (error) {
    console.error('Error getting icon for spell', spellId, ':', error.message);
  }
  
  return null;
}

const classToTabMapping = {
  warrior: [161, 164, 163],
  paladin: [381, 382, 383],
  hunter: [361, 362, 363],
  rogue: [181, 182, 183],
  priest: [201, 202, 203],
  'death-knight': [398, 399, 400],
  shaman: [261, 262, 263],
  mage: [41, 61, 81],
  warlock: [301, 302, 303],
  druid: [281, 282, 283],
};

async function generateClassSpriteSheets() {
  console.log('Generating class-specific sprite sheets...');
  
  if (!fs.existsSync(SPRITES_DIR)) {
    fs.mkdirSync(SPRITES_DIR, { recursive: true });
  }

  const config = loadConfigFile();
  const dbcDir = path.join(PUBLIC_DIR, config.paths.custom?.dbc || 'dbc');
  const talentPath = path.join(dbcDir, 'Talent.dbc');
  
  if (!fs.existsSync(talentPath)) {
    console.error('Talent.dbc not found');
    return { sheets: 0, classes: 0, mapping: {} };
  }

  const allTalents = parseTalentDBC(talentPath);
  const perClassMapping = {};
  let totalSheets = 0;

  for (const [className, tabIds] of Object.entries(classToTabMapping)) {
    // Get all talents for this class
    const classTalents = allTalents.filter(t => tabIds.includes(t.tabId));
    
    // Get unique icons needed for this class
    const iconSet = new Set();
    classTalents.forEach(talent => {
      const iconPath = getIconForSpell(talent.spellId, dbcDir);
      if (iconPath) {
        iconSet.add(iconPath);
      }
    });

    const icons = Array.from(iconSet).sort();
    
    if (icons.length === 0) {
      console.log(`⚠️  ${className}: No icons found`);
      continue;
    }

    // Find actual thumbnail files (case-insensitive)
    const thumbnails = fs.readdirSync(THUMBNAILS_DIR)
      .filter(f => f.endsWith('.png') && !fs.lstatSync(path.join(THUMBNAILS_DIR, f)).isSymbolicLink());
    
    const iconFiles = [];
    const iconMapping = {};
    
    for (const iconName of icons) {
      // Try exact match first
      let thumbnailFile = thumbnails.find(f => f.replace(/\.png$/i, '') === iconName);
      
      // Try case-insensitive match
      if (!thumbnailFile) {
        const lowerIcon = iconName.toLowerCase();
        thumbnailFile = thumbnails.find(f => f.replace(/\.png$/i, '').toLowerCase() === lowerIcon);
      }
      
      if (thumbnailFile) {
        iconFiles.push(thumbnailFile);
        iconMapping[iconName] = iconFiles.length - 1; // Store index
      }
    }

    if (iconFiles.length === 0) {
      console.log(`⚠️  ${className}: No thumbnail files found`);
      continue;
    }

    // Create sprite sheet
    const rows = Math.ceil(iconFiles.length / ICONS_PER_ROW);
    const sheetWidth = Math.min(iconFiles.length, ICONS_PER_ROW) * ICON_SIZE;
    const sheetHeight = rows * ICON_SIZE;

    const composite = [];
    
    for (let i = 0; i < iconFiles.length; i++) {
      const col = i % ICONS_PER_ROW;
      const row = Math.floor(i / ICONS_PER_ROW);
      const x = col * ICON_SIZE;
      const y = row * ICON_SIZE;

      composite.push({
        input: path.join(THUMBNAILS_DIR, iconFiles[i]),
        top: y,
        left: x,
      });
    }

    const sheetPath = path.join(SPRITES_DIR, `${className}.png`);
    
    await sharp({
      create: {
        width: sheetWidth,
        height: sheetHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
    .composite(composite)
    .png({ compressionLevel: 9, quality: 100 })
    .toFile(sheetPath);

    console.log(`✓ ${className}: ${iconFiles.length} icons (${sheetWidth}x${sheetHeight})`);
    
    // Store mapping with coordinates (per-class)
    perClassMapping[className] = {};
    for (const [iconName, idx] of Object.entries(iconMapping)) {
      const col = idx % ICONS_PER_ROW;
      const row = Math.floor(idx / ICONS_PER_ROW);
      perClassMapping[className][iconName] = {
        x: col * ICON_SIZE,
        y: row * ICON_SIZE,
      };
    }
    
    totalSheets++;
  }

  // Save mapping as JSON
  const mappingPath = path.join(SPRITES_DIR, 'sprite-map.json');
  fs.writeFileSync(mappingPath, JSON.stringify({
    iconSize: ICON_SIZE,
    iconsPerRow: ICONS_PER_ROW,
    type: 'class-based',
    classes: perClassMapping,
    generated: new Date().toISOString(),
  }, null, 2));

  console.log(`✓ Generated ${totalSheets} class sprite sheets`);
  console.log(`✓ Sprite mapping saved to sprite-map.json`);
  
  return { sheets: totalSheets, classes: totalSheets, mapping: perClassMapping };
}

export { generateClassSpriteSheets as generateSpriteSheets };

// Allow running standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  generateClassSpriteSheets()
    .then(result => {
      console.log('Sprite generation complete:', result.sheets, 'sheets');
      process.exit(0);
    })
    .catch(err => {
      console.error('Sprite generation failed:', err);
      process.exit(1);
    });
}

