import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import fileUpload from 'express-fileupload';
import cors from 'cors';
import compression from 'compression';
import sharp from 'sharp';
import { spawnSync } from 'child_process';
import { BLPFile } from './src/lib/blpconverter.js';
import { generateIconManifest, saveManifest, updateFullManifest, loadOrBuildIconList, saveIconList } from './manifest-generator.js';
import { addIconToSpellIconDbc, initializeSpellIconDbc, syncSpellIconDbcFromIcons } from './dbc-updater.js';
import { generateSpriteSheets } from './sprite-generator.js';
import genericDbcRouter from './generic-dbc-router.js';
import { readDBC, writeDBC } from './generic-dbc-parser.js';
import { definitions as DBC_DEFINITIONS } from './dbc-definitions.js';

// Error logging setup
const ERROR_LOG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'error-logs');
const ERROR_LOG_FILE = path.join(ERROR_LOG_DIR, 'server-errors.log');
if (!fs.existsSync(ERROR_LOG_DIR)) {
  fs.mkdirSync(ERROR_LOG_DIR, { recursive: true });
}
function logErrorToFile(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(ERROR_LOG_FILE, `[${timestamp}] ${message}\n`);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));
app.use(fileUpload());
app.use(cors({ origin: true }));
app.use(compression()); // Gzip compression for responses

// Cache static assets (images, icons, thumbnails)
app.use((req, res, next) => {
  if (req.url.match(/\.(png|jpg|jpeg|gif|blp|ico|webp)$/i)) {
    res.set('Cache-Control', 'public, max-age=2592000'); // 30 days for images
  } else if (req.url.match(/\.(css|js)$/i)) {
    res.set('Cache-Control', 'public, max-age=86400'); // 1 day for code
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'dist')));

// Enable CORS for Vite dev server
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

const PUBLIC_DIR = path.join(__dirname, 'public');
const EXPORT_DIR = path.resolve(__dirname, '..', 'export');
const SERVER_DBC_DIR = path.join(__dirname, '..', '..', '..', 'data', 'dbc');
const BACKUP_DBC_DIR = path.resolve(__dirname, '..', 'backups');
const CORE_SHARED_DEFINES_PATH = path.join(__dirname, '..', '..', '..', 'src', 'server', 'shared', 'SharedDefines.h');
const CORE_SPELL_AURA_DEFINES_PATH = path.join(__dirname, '..', '..', '..', 'src', 'server', 'game', 'Spells', 'Auras', 'SpellAuraDefines.h');
const CORE_SPELL_INFO_PATH = path.join(__dirname, '..', '..', '..', 'src', 'server', 'game', 'Spells', 'SpellInfo.h');
const CORE_SPELL_MGR_PATH = path.join(__dirname, '..', '..', '..', 'src', 'server', 'game', 'Spells', 'SpellMgr.h');
const CORE_SPELL_DEFINES_PATH = path.join(__dirname, '..', '..', '..', 'src', 'server', 'game', 'Spells', 'SpellDefines.h');
const WORLD_SPELL_SCRIPT_NAMES_SQL_PATH = path.join(__dirname, '..', '..', '..', 'data', 'sql', 'base', 'db_world', 'spell_script_names.sql');
const CONFIG_PATH = path.join(PUBLIC_DIR, 'config.json');
const ICON_LIST_PATH = path.join(PUBLIC_DIR, 'icon-list.json');
const SPELL_DBC_FIXER_PATH = '/root/tools/fix_spell_dbc_locale_offsets.py';

const DEFAULT_CONFIG = {
  paths: {
    base: {
      dbc: 'dbc',
      icons: 'Icons',
      description: 'Client DBC and icon sources (synced/uploaded into public)',
    },
    custom: {
      dbc: 'custom-dbc',
      icons: 'custom-icon',
      description: 'Deprecated (no longer used)',
    },
  },
  settings: {
    activeDBCSource: 'base',
    activeIconSource: 'base',
    allowBaseModification: false,
    initialized: false,
  },
};

function loadConfigFile() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      paths: {
        ...DEFAULT_CONFIG.paths,
        ...(parsed.paths || {}),
        base: { ...DEFAULT_CONFIG.paths.base, ...(parsed.paths?.base || {}) },
        custom: { ...DEFAULT_CONFIG.paths.custom, ...(parsed.paths?.custom || {}) },
      },
      settings: {
        ...DEFAULT_CONFIG.settings,
        ...(parsed.settings || {}),
      },
    };
  } catch (error) {
    console.error('Failed to read config.json:', error);
    logErrorToFile(`Failed to read config.json: ${error.stack || error}`);
    return DEFAULT_CONFIG;
  }
}

function getBaseDBCDir(config) {
  return config?.paths?.base?.dbc || DEFAULT_CONFIG.paths.base.dbc;
}

function getBaseIconDir(config) {
  return config?.paths?.base?.icons || DEFAULT_CONFIG.paths.base.icons;
}

function getActiveDBCDir(config) {
  return getBaseDBCDir(config);
}

function getActiveIconDir(config) {
  return getBaseIconDir(config);
}

function resolveDbcPath(config, filename) {
  const exportPath = path.join(EXPORT_DIR, 'DBFilesClient', filename);
  if (fs.existsSync(exportPath)) return exportPath;
  return path.join(PUBLIC_DIR, getBaseDBCDir(config), filename);
}

// DBC Parser - Read TalentTab.dbc to get tab names
function parseTalentTabDBC(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 20) return {};

    const magic = buffer.toString('utf-8', 0, 4);
    if (magic !== 'WDBC') return {};

    const recordCount = buffer.readUInt32LE(4);
    const fieldCount = buffer.readUInt32LE(8);
    const recordSize = buffer.readUInt32LE(12);
    const stringBlockSize = buffer.readUInt32LE(16);

    const headerSize = 20;
    const recordsOffset = headerSize;
    const stringBlockOffset = recordsOffset + (recordCount * recordSize);
    const tabNames = {};

    // TalentTab.dbc structure (WoW 3.3.5):
    // 0: TabID (uint32) - offset 0
    // 1-16: Name localized strings (17 string refs, offset 4-68)
    // First name (enUS) is at offset 4

    for (let i = 0; i < recordCount; i++) {
      const offset = recordsOffset + (i * recordSize);
      try {
        const tabId = buffer.readUInt32LE(offset);
        const nameOffset = buffer.readUInt32LE(offset + 4); // enUS name
        
        // Read string from string block
        if (nameOffset < stringBlockSize) {
          const stringStart = stringBlockOffset + nameOffset;
          let stringEnd = stringStart;
          while (stringEnd < buffer.length && buffer[stringEnd] !== 0) {
            stringEnd++;
          }
          const name = buffer.toString('utf-8', stringStart, stringEnd);
          if (name) {
            tabNames[tabId] = name;
          }
        }
      } catch (e) {
        // Skip malformed records
      }
    }

    return tabNames;
  } catch (error) {
    console.error('Error parsing TalentTab.dbc:', error);
    logErrorToFile(`Error parsing TalentTab.dbc: ${error.stack || error}`);
    return {};
  }
}

// DBC Parser - Read Talent.dbc to get talent data (full 23-field record)
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

    // Talent.dbc full structure (23 uint32 fields, 92 bytes per record):
    // [0]  offset  0: ID
    // [1]  offset  4: TabID (ref TalentTab.dbc)
    // [2]  offset  8: TierID (row 0-10)
    // [3]  offset 12: ColumnIndex (col 0-3)
    // [4-12] offset 16-48: SpellRank[9] (rank 1 through 9 spell IDs, 0 if unused)
    // [13-15] offset 52-60: PrereqTalent[3] (required talent IDs, 0 if none)
    // [16-18] offset 64-72: PrereqRank[3] (required points in prereq talent)
    // [19] offset 76: Flags (1 = single-point talent)
    // [20] offset 80: RequiredSpellID
    // [21-22] offset 84-88: AllowForPetFlags[2]

    for (let i = 0; i < recordCount; i++) {
      const offset = recordsOffset + (i * recordSize);
      try {
        const id = buffer.readUInt32LE(offset);
        const tabId = buffer.readUInt32LE(offset + 4);
        const tierId = buffer.readUInt32LE(offset + 8);
        const columnIndex = buffer.readUInt32LE(offset + 12);

        // Read all 9 spell ranks
        const spellRanks = [];
        for (let r = 0; r < 9; r++) {
          spellRanks.push(buffer.readUInt32LE(offset + 16 + r * 4));
        }

        // Read prereq talents (3 slots)
        const prereqTalents = [];
        for (let p = 0; p < 3; p++) {
          prereqTalents.push(buffer.readUInt32LE(offset + 52 + p * 4));
        }

        // Read prereq ranks (3 slots)
        const prereqRanks = [];
        for (let p = 0; p < 3; p++) {
          prereqRanks.push(buffer.readUInt32LE(offset + 64 + p * 4));
        }

        const flags = buffer.readUInt32LE(offset + 76);
        const requiredSpellId = buffer.readUInt32LE(offset + 80);
        const petFlags = [
          buffer.readUInt32LE(offset + 84),
          buffer.readUInt32LE(offset + 88),
        ];

        // Count actual ranks (non-zero spell IDs)
        const maxRank = spellRanks.filter(s => s !== 0).length;

        talents.push({
          id,
          tabId,
          row: tierId,
          column: columnIndex,
          spellId: spellRanks[0], // keep for backward compat
          spellRanks,
          maxRank,
          prereqTalents,
          prereqRanks,
          flags,
          requiredSpellId,
          petFlags,
        });
      } catch (e) {
        // Skip malformed records
      }
    }

    return talents;
  } catch (error) {
    console.error('Error parsing Talent.dbc:', error);
    logErrorToFile(`Error parsing Talent.dbc: ${error.stack || error}`);
    return {};
  }
}

// WoW 3.3.5 class to talent tab IDs mapping
// These are the actual tab IDs from the Talent.dbc file  
const classToTabMapping = {
  warrior: [161, 164, 163],        // Arms, Fury, Protection
  paladin: [381, 382, 383],        // Holy, Protection (Parry), Retribution
  hunter: [361, 362, 363],         // Beast Mastery (RavenForm), Marksmanship (ImprovedTracking), Survival
  rogue: [181, 182, 183],          // Assassination (Gouge), Combat (Eviscerate), Subtlety (Ambush)
  priest: [201, 202, 203],         // Discipline, Holy (HealingFocus), Shadow (Requiem)
  'death-knight': [398, 399, 400], // Blood, Frost (IceTouch), Unholy (PlagueStrike)
  shaman: [261, 262, 263],         // Elemental (WispSplode), Enhancement (MagicImmunity), Restoration (Totems)
  mage: [41, 61, 81],              // Fire (Fireball), Frost (FrostArmor), Arcane (DispelMagic)
  warlock: [301, 302, 303],        // Affliction (ShadowBolt), Demonology (Imp), Destruction
  druid: [281, 282, 283],          // Balance (Pet_Hyena), Feral (Druid_DemoralizingRoar), Restoration (Regeneration)
};

const classNameToClassId = {
  warrior: 1,
  paladin: 2,
  hunter: 3,
  rogue: 4,
  priest: 5,
  'death-knight': 6,
  shaman: 7,
  mage: 8,
  warlock: 9,
  druid: 11,
};

// Cache for expensive DBC parsing operations
const dbcCache = {
  talents: null,
  spellIconMap: null,
  spellToIconMap: null,
  spellIconIndex: null,  // Pre-built spellId → iconBaseName index
  spellNameIndex: null,  // Pre-built spellId → name index
  tabNames: null,
  lastModified: {
    talentDbc: 0,
    spellIconDbc: 0,
    spellDbc: 0,
    talentTabDbc: 0,
  }
};

let iconListCache = new Set();
let iconListWatcherActive = false;
let iconListUpdateTimer = null;
let spellEnumCache = null;
let spellEnumCacheMtimes = null;
let scriptSpellSearchEntries = null;

function loadScriptSpellSearchEntries() {
  if (scriptSpellSearchEntries) return scriptSpellSearchEntries;

  scriptSpellSearchEntries = [];
  if (!fs.existsSync(WORLD_SPELL_SCRIPT_NAMES_SQL_PATH)) {
    return scriptSpellSearchEntries;
  }

  try {
    const raw = fs.readFileSync(WORLD_SPELL_SCRIPT_NAMES_SQL_PATH, 'utf8');
    const regex = /\((\d+),'([^']+)'\)/g;
    const byId = new Map();
    let match;

    while ((match = regex.exec(raw)) !== null) {
      const spellId = Number(match[1]);
      const scriptName = String(match[2] || '').trim();
      if (!Number.isFinite(spellId) || spellId <= 0 || !scriptName) {
        continue;
      }

      if (!byId.has(spellId)) {
        byId.set(spellId, new Set());
      }
      byId.get(spellId).add(scriptName);
    }

    scriptSpellSearchEntries = Array.from(byId.entries()).map(([spellId, scriptNames]) => {
      const scriptList = Array.from(scriptNames).sort();
      const name = `[Script] ${scriptList.join(' | ')}`;
      return {
        id: spellId,
        name,
        icon: null,
        nameLower: name.toLowerCase(),
      };
    });
  } catch (error) {
    console.error('Failed to build script spell search entries:', error.message);
    scriptSpellSearchEntries = [];
  }

  return scriptSpellSearchEntries;
}

function stripCppComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function extractEnumBody(content, enumName) {
  const escaped = enumName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`enum\\s+${escaped}(?:\\s*:\\s*\\w+)?\\s*\\{([\\s\\S]*?)\\};`, 'm');
  const match = content.match(regex);
  return match ? match[1] : null;
}

function evaluateEnumExpression(expr) {
  const cleaned = String(expr || '').trim();
  if (!cleaned) return null;
  if (!/^[0-9a-fxXA-F|&<>+\-()\s]+$/.test(cleaned)) return null;
  try {
    const value = Function(`"use strict"; return (${cleaned});`)();
    return Number.isFinite(value) ? Number(value) : null;
  } catch {
    return null;
  }
}

function parseEnumEntries(enumBody) {
  if (!enumBody) return [];

  const entries = [];
  const parts = enumBody.split(',');
  let currentValue = -1;

  for (const part of parts) {
    const token = String(part || '').trim();
    if (!token) continue;

    const [rawName, rawExpr] = token.split('=').map((v) => String(v || '').trim());
    if (!rawName) continue;

    let value = null;
    if (rawExpr !== undefined && rawExpr !== '') {
      value = evaluateEnumExpression(rawExpr);
      if (value === null) continue;
      currentValue = value;
    } else {
      currentValue += 1;
      value = currentValue;
    }

    entries.push({ name: rawName, value });
  }

  return entries;
}

function formatEnumLabel(name, prefixes = []) {
  let label = String(name || '');
  for (const prefix of prefixes) {
    if (label.startsWith(prefix)) {
      label = label.slice(prefix.length);
      break;
    }
  }
  return label
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseEnumOptionsFromFile(filePath, enumName, prefixes = []) {
  if (!fs.existsSync(filePath)) return [];

  const content = stripCppComments(fs.readFileSync(filePath, 'utf8'));
  const body = extractEnumBody(content, enumName);
  const entries = parseEnumEntries(body);
  const seen = new Set();

  return entries
    .filter((entry) => {
      if (seen.has(entry.value)) return false;
      seen.add(entry.value);
      return true;
    })
    .map((entry) => ({
      value: Number(entry.value),
      label: formatEnumLabel(entry.name, prefixes),
      rawName: entry.name,
    }));
}

function buildStanceMaskOptions() {
  try {
    const config = loadConfigFile();
    const shapeshiftPath = resolveDbcPath(config, 'SpellShapeshiftForm.dbc');
    if (!fs.existsSync(shapeshiftPath)) return [];

    const data = readDBC(shapeshiftPath);
    const idIdx = getFieldIndex(data.fieldDefs, 'ID');
    const nameIndices = getLocalizedFieldIndices(data.fieldDefs, 'Name');
    if (idIdx === -1) return [];

    const options = [];
    for (const row of data.records || []) {
      const formId = Number(row[idIdx] || 0);
      if (!Number.isFinite(formId) || formId <= 0 || formId > 31) continue;
      const label = (() => {
        for (const idx of nameIndices) {
          const value = String(row[idx] || '').trim();
          if (value) return value;
        }
        return `Form ${formId}`;
      })();
      options.push({ value: (1 << (formId - 1)), label, rawName: `FORM_${formId}` });
    }

    const deduped = [];
    const seen = new Set();
    for (const option of options) {
      if (seen.has(option.value)) continue;
      seen.add(option.value);
      deduped.push(option);
    }

    deduped.sort((a, b) => a.value - b.value);
    return [{ value: 0, label: 'None', rawName: 'NONE' }, ...deduped];
  } catch {
    return [];
  }
}

function getSpellEnumPayload() {
  const mtimes = {
    sharedDefines: fs.existsSync(CORE_SHARED_DEFINES_PATH) ? fs.statSync(CORE_SHARED_DEFINES_PATH).mtimeMs : 0,
    spellAuraDefines: fs.existsSync(CORE_SPELL_AURA_DEFINES_PATH) ? fs.statSync(CORE_SPELL_AURA_DEFINES_PATH).mtimeMs : 0,
    spellInfo: fs.existsSync(CORE_SPELL_INFO_PATH) ? fs.statSync(CORE_SPELL_INFO_PATH).mtimeMs : 0,
    spellMgr: fs.existsSync(CORE_SPELL_MGR_PATH) ? fs.statSync(CORE_SPELL_MGR_PATH).mtimeMs : 0,
    spellDefines: fs.existsSync(CORE_SPELL_DEFINES_PATH) ? fs.statSync(CORE_SPELL_DEFINES_PATH).mtimeMs : 0,
  };

  if (spellEnumCache && spellEnumCacheMtimes
    && spellEnumCacheMtimes.sharedDefines === mtimes.sharedDefines
    && spellEnumCacheMtimes.spellAuraDefines === mtimes.spellAuraDefines
    && spellEnumCacheMtimes.spellInfo === mtimes.spellInfo
    && spellEnumCacheMtimes.spellMgr === mtimes.spellMgr
    && spellEnumCacheMtimes.spellDefines === mtimes.spellDefines) {
    return spellEnumCache;
  }

  const spellSchools = parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'SpellSchools', ['SPELL_SCHOOL_']);

  spellEnumCache = {
    spellFamilyName: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'SpellFamilyNames', ['SPELLFAMILY_']),
    effectTargets: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'Targets', ['TARGET_']),
    effectTypes: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'SpellEffects', ['SPELL_EFFECT_']),
    auraTypes: parseEnumOptionsFromFile(CORE_SPELL_AURA_DEFINES_PATH, 'AuraType', ['SPELL_AURA_']),
    mechanics: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'Mechanics', ['MECHANIC_']),
    dispelTypes: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'DispelType', ['DISPEL_']),
    powerTypes: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'Powers', ['POWER_']),
    preventionTypes: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'SpellPreventionType', ['SPELL_PREVENTION_TYPE_']),
    damageClasses: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'SpellDmgClass', ['SPELL_DAMAGE_CLASS_']),
    auraStates: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'AuraStateType', ['AURA_STATE_']),
    creatureTypes: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'CreatureType', ['CREATURE_TYPE_']),
    targetFlags: parseEnumOptionsFromFile(CORE_SPELL_INFO_PATH, 'SpellCastTargetFlags', ['TARGET_FLAG_']),
    procFlags: parseEnumOptionsFromFile(CORE_SPELL_MGR_PATH, 'ProcFlags', ['PROC_FLAG_']),
    interruptFlags: parseEnumOptionsFromFile(CORE_SPELL_DEFINES_PATH, 'SpellInterruptFlags', ['SPELL_INTERRUPT_FLAG_']),
    auraInterruptFlags: parseEnumOptionsFromFile(CORE_SPELL_DEFINES_PATH, 'SpellAuraInterruptFlags', ['AURA_INTERRUPT_FLAG_']),
    channelInterruptFlags: parseEnumOptionsFromFile(CORE_SPELL_DEFINES_PATH, 'SpellChannelInterruptFlags', ['CHANNEL_INTERRUPT_FLAG_']),
    stancesMask: buildStanceMaskOptions(),
    spellAttr0: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'SpellAttr0', ['SPELL_ATTR0_']),
    spellAttr1: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'SpellAttr1', ['SPELL_ATTR1_']),
    spellAttr2: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'SpellAttr2', ['SPELL_ATTR2_']),
    spellAttr3: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'SpellAttr3', ['SPELL_ATTR3_']),
    spellAttr4: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'SpellAttr4', ['SPELL_ATTR4_']),
    spellAttr5: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'SpellAttr5', ['SPELL_ATTR5_']),
    spellAttr6: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'SpellAttr6', ['SPELL_ATTR6_']),
    spellAttr7: parseEnumOptionsFromFile(CORE_SHARED_DEFINES_PATH, 'SpellAttr7', ['SPELL_ATTR7_']),
    schoolMaskBits: [
      { value: 0, label: 'None', rawName: 'SPELL_SCHOOL_MASK_NONE' },
      ...spellSchools
        .filter((entry) => Number.isFinite(entry.value) && entry.value >= 0 && entry.value <= 31)
        .map((entry) => ({
          value: entry.value === 0 ? 1 : (1 << entry.value),
          label: entry.label,
          rawName: `SPELL_SCHOOL_MASK_${entry.rawName}`,
        }))
        .filter((entry, index, arr) => arr.findIndex((v) => v.value === entry.value) === index),
    ],
  };

  spellEnumCacheMtimes = mtimes;
  return spellEnumCache;
}

function getIconDirPath(config) {
  return path.join(PUBLIC_DIR, getBaseIconDir(config));
}

function loadIconListCache(iconDir) {
  const list = loadOrBuildIconList(iconDir);
  iconListCache = new Set(list);
  return list;
}

function persistIconListCache() {
  const list = Array.from(iconListCache).sort((a, b) => a.localeCompare(b));
  saveIconList(list);
  return list;
}

function scheduleManifestUpdate(iconDir, dbcPath) {
  if (iconListUpdateTimer) return;
  iconListUpdateTimer = setTimeout(() => {
    iconListUpdateTimer = null;
        const iconList = persistIconListCache();
        updateFullManifest(iconDir, dbcPath, { iconList, skipThumbnails: true })
          .catch(err => console.error('Background manifest update failed:', err));
  }, 1000);
}

function startIconListWatcher(iconDir, dbcPath) {
  if (iconListWatcherActive) return;
  if (!fs.existsSync(iconDir)) return;

  const ensureLoaded = () => {
    if (iconListCache.size === 0) loadIconListCache(iconDir);
  };

  ensureLoaded();

  fs.watch(iconDir, { recursive: false }, (eventType, filename) => {
    if (!filename || !filename.toLowerCase().endsWith('.blp')) return;
    ensureLoaded();
    const filePath = path.join(iconDir, filename);
    if (fs.existsSync(filePath)) {
      iconListCache.add(filename);
    } else {
      iconListCache.delete(filename);
    }
    scheduleManifestUpdate(iconDir, dbcPath);
  });

  iconListWatcherActive = true;
}

// ===== Spell-Icon Index =====
// Pre-builds a direct spellId → iconBaseName mapping, collapsing the
// Spell.dbc (spellId→spellIconId) + SpellIcon.dbc (spellIconId→iconPath) join
// into a single fast lookup. Persists to disk and only rebuilds when DBC files change.

const SPELL_ICON_INDEX_PATH = path.join(PUBLIC_DIR, 'spell-icon-index.json');
const SPELL_NAME_INDEX_PATH = path.join(PUBLIC_DIR, 'spell-name-index.json');
const SPELL_NAME_INDEX_VERSION = 2;
const SPELL_EXPORT_DBC_PATH = path.join(EXPORT_DIR, 'DBFilesClient', 'Spell.dbc');

const SPELL_EDITABLE_FIELDS = {
  selectSpell: ['SpellName', 'SpellRank', 'SpellToolTip', 'SpellDescription'],
  base: ['Category', 'Dispel', 'Mechanic', 'CastingTimeIndex', 'DurationIndex', 'RangeIndex', 'MaximumLevel', 'BaseLevel', 'SpellLevel', 'RecoveryTime', 'CategoryRecoveryTime', 'StartRecoveryCategory', 'StartRecoveryTime', 'PowerType', 'ManaCost', 'ManaCostPerLevel', 'ManaPerSecond', 'ManaPerSecondPerLevel', 'ManaCostPercentage', 'Speed', 'StackAmount', 'ModalNextSpell', 'MaximumTargetLevel', 'MaximumAffectedTargets', 'RequiresSpellFocus', 'PreventionType', 'DamageClass', 'SpellFamilyName', 'SchoolMask', 'SpellMissileID', 'SpellVisual1', 'SpellVisual2', 'SpellIconID', 'ActiveIconID', 'SpellPriority', 'RuneCostID', 'SpellDescriptionVariableID', 'SpellDifficultyID'],
  targetsProcs: ['Targets', 'TargetCreatureType', 'FacingCasterFlags', 'ProcFlags', 'ProcChance', 'ProcCharges', 'CasterAuraState', 'TargetAuraState', 'CasterAuraStateNot', 'TargetAuraStateNot', 'CasterAuraSpell', 'TargetAuraSpell', 'ExcludeCasterAuraSpell', 'ExcludeTargetAuraSpell'],
  effects: ['Effect1', 'Effect2', 'Effect3', 'EffectDieSides1', 'EffectDieSides2', 'EffectDieSides3', 'EffectRealPointsPerLevel1', 'EffectRealPointsPerLevel2', 'EffectRealPointsPerLevel3', 'EffectBasePoints1', 'EffectBasePoints2', 'EffectBasePoints3', 'EffectMechanic1', 'EffectMechanic2', 'EffectMechanic3', 'EffectImplicitTargetA1', 'EffectImplicitTargetA2', 'EffectImplicitTargetA3', 'EffectImplicitTargetB1', 'EffectImplicitTargetB2', 'EffectImplicitTargetB3', 'EffectRadiusIndex1', 'EffectRadiusIndex2', 'EffectRadiusIndex3', 'EffectApplyAuraName1', 'EffectApplyAuraName2', 'EffectApplyAuraName3', 'EffectAmplitude1', 'EffectAmplitude2', 'EffectAmplitude3', 'EffectMultipleValue1', 'EffectMultipleValue2', 'EffectMultipleValue3', 'EffectChainTarget1', 'EffectChainTarget2', 'EffectChainTarget3', 'EffectItemType1', 'EffectItemType2', 'EffectItemType3', 'EffectMiscValue1', 'EffectMiscValue2', 'EffectMiscValue3', 'EffectMiscValueB1', 'EffectMiscValueB2', 'EffectMiscValueB3', 'EffectTriggerSpell1', 'EffectTriggerSpell2', 'EffectTriggerSpell3', 'EffectPointsPerComboPoint1', 'EffectPointsPerComboPoint2', 'EffectPointsPerComboPoint3', 'EffectSpellClassMaskA1', 'EffectSpellClassMaskA2', 'EffectSpellClassMaskA3', 'EffectSpellClassMaskB1', 'EffectSpellClassMaskB2', 'EffectSpellClassMaskB3', 'EffectSpellClassMaskC1', 'EffectSpellClassMaskC2', 'EffectSpellClassMaskC3'],
  items: ['Totem1', 'Totem2', 'Reagent1', 'Reagent2', 'Reagent3', 'Reagent4', 'Reagent5', 'Reagent6', 'Reagent7', 'Reagent8', 'ReagentCount1', 'ReagentCount2', 'ReagentCount3', 'ReagentCount4', 'ReagentCount5', 'ReagentCount6', 'ReagentCount7', 'ReagentCount8', 'EquippedItemClass', 'EquippedItemSubClassMask', 'EquippedItemInventoryTypeMask', 'TotemCategory1', 'TotemCategory2'],
  flags: ['Attributes', 'AttributesEx', 'AttributesEx2', 'AttributesEx3', 'AttributesEx4', 'AttributesEx5', 'AttributesEx6', 'AttributesEx7', 'InterruptFlags', 'AuraInterruptFlags', 'ChannelInterruptFlags', 'Stances', 'StancesNot'],
  icon: ['SpellIconID', 'ActiveIconID'],
  visual: ['SpellVisual1', 'SpellVisual2', 'SpellMissileID', 'PowerDisplayId', 'AreaGroupID', 'RequiredAuraVision'],
};

let customSpellTableSchema = null;
const CUSTOM_SPELL_DB = String(process.env.CUSTOM_SPELL_DB || 'sdbeditor').replace(/`/g, '');

function normalizeFieldName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getAllEditableFieldNames() {
  return Object.values(SPELL_EDITABLE_FIELDS).flat();
}

function resolveSpellDbConfigFromWorldserver() {
  const worldConfPath = path.join(__dirname, '..', '..', '..', 'env', 'dist', 'etc', 'worldserver.conf');
  if (!fs.existsSync(worldConfPath)) return null;

  const content = fs.readFileSync(worldConfPath, 'utf8');
  const match = content.match(/WorldDatabaseInfo\s*=\s*"([^"]+)"/);
  if (!match) return null;

  const parts = match[1].split(';');
  if (parts.length < 5) return null;

  const [host, port, user, password, database] = parts;
  return {
    host: host || '127.0.0.1',
    port: Number(port || 3306),
    user,
    password,
    database,
  };
}

async function withCustomSpellConnection(fn) {
  const cfg = resolveSpellDbConfigFromWorldserver();
  if (!cfg) return null;
  const connection = await mysql.createConnection({
    ...cfg,
    connectTimeout: 1500,
  });
  try {
    return await fn(connection);
  } finally {
    await connection.end();
  }
}

async function loadCustomSpellSchema() {
  if (customSpellTableSchema) return customSpellTableSchema;

  const result = await withCustomSpellConnection(async (conn) => {
    const [dbRows] = await conn.query(`SHOW DATABASES LIKE '${CUSTOM_SPELL_DB}'`);
    if (!Array.isArray(dbRows) || !dbRows.length) return null;

    const [tableRows] = await conn.query(`SHOW TABLES FROM \`${CUSTOM_SPELL_DB}\` LIKE 'spell'`);
    if (!Array.isArray(tableRows) || !tableRows.length) return null;

    const [cols] = await conn.query(`SHOW COLUMNS FROM \`${CUSTOM_SPELL_DB}\`.\`spell\``);
    const normalizedToActual = {};
    for (const c of cols) {
      const actual = c.Field;
      normalizedToActual[normalizeFieldName(actual)] = actual;
    }
    return { normalizedToActual, columnCount: cols.length };
  });

  customSpellTableSchema = result;
  return result;
}

async function mirrorSpellToCustomTable(spellId, fieldsPatch) {
  const schema = await loadCustomSpellSchema();
  if (!schema) return { mirrored: false, reason: 'custom-spell-schema-missing' };

  const mapped = {};
  for (const [field, value] of Object.entries(fieldsPatch || {})) {
    const actualColumn = schema.normalizedToActual[normalizeFieldName(field)];
    if (!actualColumn) continue;
    mapped[actualColumn] = value;
  }

  if (!Object.keys(mapped).length) {
    return { mirrored: false, reason: 'no-matching-columns' };
  }

  return withCustomSpellConnection(async (conn) => {
    const [existingRows] = await conn.query(`SELECT \`ID\` FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` WHERE \`ID\` = ? LIMIT 1`, [spellId]);

    if (Array.isArray(existingRows) && existingRows.length) {
      const setSql = Object.keys(mapped).map((col) => `\`${col}\` = ?`).join(', ');
      const values = [...Object.values(mapped), spellId];
      await conn.query(`UPDATE \`${CUSTOM_SPELL_DB}\`.\`spell\` SET ${setSql} WHERE \`ID\` = ?`, values);
      return { mirrored: true, mode: 'update', columns: Object.keys(mapped) };
    }

    const columns = ['ID', ...Object.keys(mapped)];
    const placeholders = columns.map(() => '?').join(', ');
    const values = [spellId, ...Object.values(mapped)];
    await conn.query(`INSERT INTO \`${CUSTOM_SPELL_DB}\`.\`spell\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES (${placeholders})`, values);
    return { mirrored: true, mode: 'insert', columns: Object.keys(mapped) };
  });
}

const CUSTOM_SPELL_FIELD_ALIASES = {
  SpellName0: 'SpellName',
  SpellRank0: 'Rank',
  SpellDescription0: 'Description',
  SpellToolTip0: 'ToolTip',
  MaxLevel: 'MaximumLevel',
  MaxTargetLevel: 'MaximumTargetLevel',
  MaxAffectedTargets: 'MaximumAffectedTargets',
  DispelType: 'Dispel',
  DmgClass: 'DamageClass',
  PowerDisplayID: 'PowerDisplayId',
  SpellVisualID1: 'SpellVisual1',
  SpellVisualID2: 'SpellVisual2',
  SpellVisualID_1: 'SpellVisual1',
  SpellVisualID_2: 'SpellVisual2',
};

function mapCustomColumnToField(columnName) {
  const raw = String(columnName || '').trim();
  if (!raw) return null;
  if (CUSTOM_SPELL_FIELD_ALIASES[raw]) return CUSTOM_SPELL_FIELD_ALIASES[raw];
  if (/^SpellName\d+$/.test(raw)) return raw === 'SpellName0' ? 'SpellName' : null;
  if (/^SpellRank\d+$/.test(raw)) return raw === 'SpellRank0' ? 'Rank' : null;
  if (/^SpellDescription\d+$/.test(raw)) return raw === 'SpellDescription0' ? 'Description' : null;
  if (/^SpellToolTip\d+$/.test(raw)) return raw === 'SpellToolTip0' ? 'ToolTip' : null;
  return raw;
}

function buildCustomSpellOverrides(customRow) {
  if (!customRow || typeof customRow !== 'object') return {};

  const allowedFields = new Set([...getAllEditableFieldNames(), 'SpellName', 'Rank', 'Description', 'ToolTip', 'SpellIconID']);
  const overrides = {};

  for (const [column, value] of Object.entries(customRow)) {
    const mappedField = mapCustomColumnToField(column);
    if (!mappedField || !allowedFields.has(mappedField)) continue;
    if (value === null || value === undefined) continue;
    overrides[mappedField] = value;
  }

  return overrides;
}

function applyCustomOverridesToSpellDetails(details, overrides) {
  if (!details || !overrides || !Object.keys(overrides).length) return details;

  const patched = JSON.parse(JSON.stringify(details));

  if (overrides.SpellName !== undefined) patched.name = String(overrides.SpellName || '').trim() || patched.name;
  if (overrides.Rank !== undefined) patched.rank = String(overrides.Rank || '').trim();
  if (overrides.Description !== undefined) patched.description = String(overrides.Description || '').trim();
  if (overrides.ToolTip !== undefined) patched.toolTip = String(overrides.ToolTip || '').trim();
  if (overrides.SpellIconID !== undefined) patched.spellIconId = Number(overrides.SpellIconID || patched.spellIconId || 0);

  for (const section of Object.keys(SPELL_EDITABLE_FIELDS)) {
    for (const fieldName of SPELL_EDITABLE_FIELDS[section]) {
      if (Object.prototype.hasOwnProperty.call(overrides, fieldName)) {
        patched.editable[section][fieldName] = overrides[fieldName];
      }
    }
  }

  return patched;
}

async function getCustomSpellRow(spellId) {
  try {
    const schema = await loadCustomSpellSchema();
    if (!schema) return null;

    const result = await withCustomSpellConnection(async (conn) => {
      const [rows] = await conn.query(`SELECT * FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` WHERE \`ID\` = ? LIMIT 1`, [spellId]);
      if (!Array.isArray(rows) || !rows.length) return null;
      return rows[0];
    });
    return result || null;
  } catch {
    return null;
  }
}

function buildOrderedEditableFromOverrides(overrides) {
  const editable = {};
  for (const section of Object.keys(SPELL_EDITABLE_FIELDS)) {
    editable[section] = {};
    for (const fieldName of SPELL_EDITABLE_FIELDS[section]) {
      editable[section][fieldName] = Object.prototype.hasOwnProperty.call(overrides, fieldName)
        ? overrides[fieldName]
        : null;
    }
  }
  return editable;
}

async function buildSqlOnlySpellDetails(spellId) {
  const customRow = await getCustomSpellRow(spellId);
  if (!customRow) return null;

  const overrides = buildCustomSpellOverrides(customRow);
  const editable = buildOrderedEditableFromOverrides(overrides);
  const spellIconId = Number(overrides.SpellIconID || editable.icon?.SpellIconID || 0);
  const details = {
    spellId,
    spellIconId,
    icon: await getSpellIconNameById(spellIconId),
    name: String(overrides.SpellName || customRow.SpellName0 || `Spell ${spellId}`),
    rank: String(overrides.Rank || customRow.SpellRank0 || ''),
    description: String(overrides.Description || customRow.SpellDescription0 || ''),
    toolTip: String(overrides.ToolTip || customRow.SpellToolTip0 || ''),
    editable,
    customSpell: {
      available: true,
      hasRecord: true,
      source: 'custom-sql',
    },
  };

  details.referenceTables = await buildSpellReferenceSummary(details);
  return details;
}

async function getSpellSearchEntriesFromSql(queryText, limit) {
  const schema = await loadCustomSpellSchema();
  if (!schema) return [];

  const nameColumn =
    schema.normalizedToActual.spellname0 ||
    schema.normalizedToActual.spellname ||
    schema.normalizedToActual.name ||
    null;

  const q = String(queryText || '').trim();
  if (!q || q.length < 2) return [];

  return withCustomSpellConnection(async (conn) => {
    let rows = [];
    if (nameColumn) {
      const [result] = await conn.query(
        `SELECT \`ID\`, \`${nameColumn}\` AS \`SpellName\` FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` WHERE CAST(\`ID\` AS CHAR) LIKE ? OR \`${nameColumn}\` LIKE ? ORDER BY \`ID\` ASC LIMIT ?`,
        [`%${q}%`, `%${q}%`, Math.max(1, Math.min(Number(limit) || 50, 200))]
      );
      rows = Array.isArray(result) ? result : [];
    } else {
      const [result] = await conn.query(
        `SELECT \`ID\` FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` WHERE CAST(\`ID\` AS CHAR) LIKE ? ORDER BY \`ID\` ASC LIMIT ?`,
        [`%${q}%`, Math.max(1, Math.min(Number(limit) || 50, 200))]
      );
      rows = Array.isArray(result) ? result : [];
    }

    return rows
      .map((row) => {
        const id = Number(row.ID || 0);
        if (!Number.isFinite(id) || id <= 0) return null;
        const name = String(row.SpellName || `Spell ${id}`).trim() || `Spell ${id}`;
        return {
          id,
          name,
          icon: null,
          nameLower: name.toLowerCase(),
        };
      })
      .filter(Boolean);
  });
}

const SPELL_REF_FIELD_CONFIG = {
  SpellIconID: { table: 'spellicon', labelExpr: 'COALESCE(NULLIF(Name,\'\'), CONCAT(\'Icon \', ID))' },
  ActiveIconID: { table: 'spellicon', labelExpr: 'COALESCE(NULLIF(Name,\'\'), CONCAT(\'Icon \', ID))' },
  SpellVisual1: { table: 'spellvisual', labelExpr: 'CONCAT(\'Visual \', ID)' },
  SpellVisual2: { table: 'spellvisual', labelExpr: 'CONCAT(\'Visual \', ID)' },
  SpellMissileID: { table: 'spellmissile', labelExpr: 'CONCAT(\'Missile \', ID)' },
  VisualKit: { table: 'spellvisualkit', labelExpr: 'CONCAT(\'Kit \', ID)' },
  VisualEffectName: { table: 'spellvisualeffectname', labelExpr: 'COALESCE(NULLIF(Name,\'\'), CONCAT(\'Effect \', ID))' },
  MissilePreset: { table: 'spellmissile', labelExpr: 'CONCAT(\'Missile \', ID)' },
  MissileMotionPreset: { table: 'spellmissilemotion', labelExpr: 'COALESCE(NULLIF(name,\'\'), CONCAT(\'Motion \', ID))' },
  AreaModel: { table: 'spellvisualkitareamodel', labelExpr: 'COALESCE(NULLIF(Name,\'\'), CONCAT(\'Area \', ID))' },
};

function toSafeReferenceLimit(rawValue, fallback = 40) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(200, Math.max(1, Math.trunc(parsed)));
}

function toSafeNumericSearch(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  return value.replace(/[^0-9]/g, '');
}

async function querySpellReferenceOptions(fieldName, searchValue, limit = 40) {
  const cfg = SPELL_REF_FIELD_CONFIG[fieldName];
  if (!cfg) return [];

  const safeLimit = toSafeReferenceLimit(limit);
  const search = toSafeNumericSearch(searchValue);

  try {
    const result = await withCustomSpellConnection(async (conn) => {
      if (search) {
        const [rows] = await conn.query(
          `SELECT ID, ${cfg.labelExpr} AS label FROM \`${CUSTOM_SPELL_DB}\`.\`${cfg.table}\` WHERE CAST(ID AS CHAR) LIKE ? ORDER BY ID ASC LIMIT ?`,
          [`${search}%`, safeLimit]
        );
        return rows || [];
      }

      const [rows] = await conn.query(
        `SELECT ID, ${cfg.labelExpr} AS label FROM \`${CUSTOM_SPELL_DB}\`.\`${cfg.table}\` ORDER BY ID ASC LIMIT ?`,
        [safeLimit]
      );
      return rows || [];
    });

    return (result || []).map((row) => ({
      value: Number(row.ID || 0),
      label: String(row.label || `${cfg.table} ${row.ID}`),
    }));
  } catch {
    return [];
  }
}

async function buildSpellReferenceSummary(details) {
  if (!details?.editable) return {};

  const values = {
    SpellIconID: Number(details?.editable?.icon?.SpellIconID ?? details?.spellIconId ?? 0),
    ActiveIconID: Number(details?.editable?.icon?.ActiveIconID ?? 0),
    SpellVisual1: Number(details?.editable?.visual?.SpellVisual1 ?? 0),
    SpellVisual2: Number(details?.editable?.visual?.SpellVisual2 ?? 0),
    SpellMissileID: Number(details?.editable?.visual?.SpellMissileID ?? 0),
  };

  const summary = {};
  for (const [fieldName, fieldValue] of Object.entries(values)) {
    if (!Number.isFinite(fieldValue) || fieldValue <= 0) {
      summary[fieldName] = { value: fieldValue || 0, exists: false, label: null, table: SPELL_REF_FIELD_CONFIG[fieldName].table };
      continue;
    }
    const options = await querySpellReferenceOptions(fieldName, String(Math.trunc(fieldValue)), 1);
    const hit = options.find((opt) => Number(opt.value) === Math.trunc(fieldValue));
    summary[fieldName] = {
      value: Math.trunc(fieldValue),
      exists: !!hit,
      label: hit ? hit.label : null,
      table: SPELL_REF_FIELD_CONFIG[fieldName].table,
    };
  }

  return summary;
}

async function buildEffectiveSpellDetails(spellId, spellData, row) {
  let details = readSpellDetailsFromData(spellData, row);

  const customRow = await getCustomSpellRow(spellId);
  if (customRow) {
    const overrides = buildCustomSpellOverrides(customRow);
    details = applyCustomOverridesToSpellDetails(details, overrides);
    details.customSpell = {
      available: true,
      hasRecord: true,
      source: 'custom-override',
    };
  } else {
    details.customSpell = {
      available: !!(await loadCustomSpellSchema()),
      hasRecord: false,
      source: 'dbc',
    };
  }

  details.referenceTables = await buildSpellReferenceSummary(details);
  return details;
}

function isLikelySpellName(name) {
  if (!name) return false;
  const value = String(name).trim();
  if (value.length < 2 || value.length > 80) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (/[${}<>{}\[\]]/.test(value)) return false;
  if (/spell editor|tooltip|<mult>|\$\d+/i.test(value)) return false;
  return true;
}

function scoreSpellNameField(spellData, fieldIdx) {
  const sampleSize = Math.min(spellData.records.length, 4000);
  const fieldName = String(spellData.fieldDefs[fieldIdx]?.name || '');
  let nonEmpty = 0;
  let likely = 0;
  let noisy = 0;

  for (let i = 0; i < sampleSize; i++) {
    const raw = String(spellData.records[i]?.[fieldIdx] || '').trim();
    if (!raw) continue;
    nonEmpty++;
    if (isLikelySpellName(raw)) likely++;
    if (/[${}<>{}\[\]]/.test(raw) || raw.length > 90) noisy++;
  }

  let score = likely * 3 + nonEmpty - noisy * 2;
  if (fieldName === 'SpellName') score += 25;
  if (fieldName.startsWith('SpellName_')) score += 15;
  return { score, nonEmpty, likely, fieldName };
}

function selectBestSpellNameFieldIndex(spellData) {
  const stringFieldIndices = spellData.fieldDefs
    .map((fd, idx) => ({ fd, idx }))
    .filter(({ fd }) => fd?.type === 'string')
    .map(({ idx }) => idx);

  if (!stringFieldIndices.length) return -1;

  let bestIdx = -1;
  let bestScore = -Infinity;
  for (const idx of stringFieldIndices) {
    const { score } = scoreSpellNameField(spellData, idx);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

function getPreferredSpellNameFieldIndices(spellData, fallbackFieldIdx) {
  const preferred = spellData.fieldDefs
    .map((fd, idx) => ({ name: String(fd?.name || ''), idx }))
    .filter(({ name }) => name === 'SpellName' || name.startsWith('SpellName_'))
    .map(({ idx }) => idx);

  if (preferred.length) return preferred;
  return fallbackFieldIdx >= 0 ? [fallbackFieldIdx] : [];
}

function pickSpellNameFromRow(row, nameFieldIndices) {
  for (const idx of nameFieldIndices) {
    const raw = String(row[idx] || '').trim();
    if (!raw) continue;
    if (isLikelySpellName(raw)) return raw;
  }
  return '';
}

function getLocalizedFieldIndices(fieldDefs, baseName) {
  const exact = fieldDefs.findIndex((fd) => fd.name === baseName);
  const localeIndices = fieldDefs
    .map((fd, idx) => ({ name: String(fd?.name || ''), idx }))
    .filter(({ name }) => name === baseName || name.startsWith(`${baseName}_`))
    .map(({ idx }) => idx);

  if (localeIndices.length) return localeIndices;
  return exact >= 0 ? [exact] : [];
}

function pickLocalizedFieldFromRow(row, fieldDefs, baseName) {
  const indices = getLocalizedFieldIndices(fieldDefs, baseName);
  for (const idx of indices) {
    const value = String(row[idx] || '').trim();
    if (value) return value;
  }
  return '';
}

function getSpellEditableDbcPath(config) {
  const basePath = resolveDbcPath(config, 'Spell.dbc');
  if (!fs.existsSync(SPELL_EXPORT_DBC_PATH)) {
    const exportDir = path.dirname(SPELL_EXPORT_DBC_PATH);
    fs.mkdirSync(exportDir, { recursive: true });
    fs.copyFileSync(basePath, SPELL_EXPORT_DBC_PATH);
  }
  return SPELL_EXPORT_DBC_PATH;
}

function getFieldIndex(fieldDefs, fieldName) {
  const normalized = normalizeFieldName(fieldName);
  return fieldDefs.findIndex((fd) => normalizeFieldName(fd.name) === normalized);
}

function readSpellDetailsFromData(spellData, row) {
  const idFieldIdx = getFieldIndex(spellData.fieldDefs, 'ID');
  const iconFieldIdx = getFieldIndex(spellData.fieldDefs, 'SpellIconID');
  const bestNameFieldIdx = selectBestSpellNameFieldIndex(spellData);
  const nameFieldIndices = getPreferredSpellNameFieldIndices(spellData, bestNameFieldIdx);
  const spellId = Number(row[idFieldIdx] || 0);

  if (!dbcCache.spellIconIndex) {
    try { loadOrBuildSpellIconIndex(); } catch (e) { /* ignore */ }
  }
  const spellIconIndex = dbcCache.spellIconIndex || {};

  const readFieldValue = (fieldName) => {
    if (fieldName === 'SpellName') {
      return pickLocalizedFieldFromRow(row, spellData.fieldDefs, 'SpellName');
    }
    if (fieldName === 'SpellRank' || fieldName === 'Rank') {
      return pickLocalizedFieldFromRow(row, spellData.fieldDefs, 'Rank');
    }
    if (fieldName === 'SpellDescription' || fieldName === 'Description') {
      return pickLocalizedFieldFromRow(row, spellData.fieldDefs, 'Description');
    }
    if (fieldName === 'SpellToolTip' || fieldName === 'ToolTip') {
      return pickLocalizedFieldFromRow(row, spellData.fieldDefs, 'ToolTip');
    }
    const idx = getFieldIndex(spellData.fieldDefs, fieldName);
    if (idx === -1) return null;
    return row[idx];
  };

  const editable = {};
  for (const section of Object.keys(SPELL_EDITABLE_FIELDS)) {
    editable[section] = {};
    for (const fieldName of SPELL_EDITABLE_FIELDS[section]) {
      editable[section][fieldName] = readFieldValue(fieldName);
    }
  }

  return {
    spellId,
    spellIconId: iconFieldIdx >= 0 ? Number(row[iconFieldIdx] || 0) : 0,
    icon: spellIconIndex[spellId] || null,
    name: pickSpellNameFromRow(row, nameFieldIndices) || `Spell ${spellId}`,
    rank: pickLocalizedFieldFromRow(row, spellData.fieldDefs, 'Rank'),
    description: pickLocalizedFieldFromRow(row, spellData.fieldDefs, 'Description'),
    toolTip: pickLocalizedFieldFromRow(row, spellData.fieldDefs, 'ToolTip'),
    editable,
  };
}

function coerceFieldValue(fieldDef, rawValue) {
  if (fieldDef.type === 'string') {
    return String(rawValue ?? '').trim();
  }

  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) return null;

  if (fieldDef.type === 'float') return numeric;
  if (fieldDef.type === 'int32') return Math.trunc(numeric);
  return Math.max(0, Math.trunc(numeric));
}

function normalizeSpellPatchFields(fieldsPatch) {
  const result = {};
  for (const [key, value] of Object.entries(fieldsPatch || {})) {
    if (key === 'SpellRank') {
      result.Rank = value;
      continue;
    }
    if (key === 'SpellDescription') {
      result.Description = value;
      continue;
    }
    if (key === 'SpellToolTip') {
      result.ToolTip = value;
      continue;
    }
    result[key] = value;
  }
  return result;
}

function applySpellFieldPatch(spellData, row, fieldsPatch) {
  const normalizedPatch = normalizeSpellPatchFields(fieldsPatch);
  const updated = [];
  const skipped = [];

  for (const [fieldName, rawValue] of Object.entries(normalizedPatch)) {
    const idx = getFieldIndex(spellData.fieldDefs, fieldName);
    if (idx === -1) {
      skipped.push({ field: fieldName, reason: 'unknown-field' });
      continue;
    }

    const fieldDef = spellData.fieldDefs[idx];
    const coerced = coerceFieldValue(fieldDef, rawValue);
    if (coerced === null && fieldDef.type !== 'string') {
      skipped.push({ field: fieldName, reason: 'invalid-value' });
      continue;
    }

    row[idx] = coerced;
    updated.push(fieldName);
  }

  return { updated, skipped };
}

function invalidateSpellCaches() {
  dbcCache.spellNameIndex = null;
  dbcCache.spellIconIndex = null;
  dbcCache.lastModified.spellDbc = 0;
}

// Locstring/localized fields need string-block growth to edit safely - not
// attempted here. Everything else in SPELL_EDITABLE_FIELDS is a plain
// 4-byte numeric/flag/reference column, safe for a raw offset patch.
const SPELL_DBC_STRING_FIELDS = new Set(['SpellName', 'Rank', 'Description', 'ToolTip']);

// Patch numeric Spell.dbc fields directly into the binary file from a
// SQL-sourced fields patch, so the SQL editor's saves actually make it into
// the exported/live DBC (previously the SQL `sdbeditor.spell` table was the
// only thing that got updated - the binary Spell.dbc never changed at all,
// so exports always served stale data no matter what was edited).
//
// Per the modify-client-spell-visuals skill, Spell.dbc (234 partially-named
// fields) is NEVER safe for a full readDBC()->mutate->writeDBC() round trip.
// This only ever raw-patches the exact 4-byte slots it touches, on a buffer
// freshly read via fs.readFileSync, and never reserializes the whole file.
// readDBC() is used ONLY to locate fieldDefs/record index - not to rebuild
// or write anything.
function patchSpellDbcFromSql(spellId, fieldsPatch) {
  const numericPatch = {};
  for (const [field, value] of Object.entries(fieldsPatch || {})) {
    if (SPELL_DBC_STRING_FIELDS.has(field)) continue;
    numericPatch[field] = value;
  }
  if (!Object.keys(numericPatch).length) {
    return { patched: false, reason: 'no-numeric-fields' };
  }

  const liveDbcPath = path.join(SERVER_DBC_DIR, 'Spell.dbc');
  if (!fs.existsSync(liveDbcPath)) {
    return { patched: false, reason: 'spell-dbc-not-found' };
  }

  let spellData;
  try {
    spellData = readDBC(liveDbcPath);
  } catch (err) {
    return { patched: false, reason: `read-failed: ${err.message}` };
  }

  const idFieldIdx = getFieldIndex(spellData.fieldDefs, 'ID');
  if (idFieldIdx === -1) return { patched: false, reason: 'no-id-field' };

  let recordIndex = -1;
  for (let i = 0; i < spellData.records.length; i++) {
    if (Number(spellData.records[i][idFieldIdx]) === Number(spellId)) {
      recordIndex = i;
      break;
    }
  }
  if (recordIndex === -1) {
    return { patched: false, reason: 'spell-not-in-dbc' };
  }

  backupDbcOnce(liveDbcPath, 'pre-sql-field-patch');

  const buffer = fs.readFileSync(liveDbcPath);
  const recordCount = buffer.readUInt32LE(4);
  const recordSize = buffer.readUInt32LE(12);
  const headerSize = 20;
  const recordsEnd = headerSize + recordCount * recordSize;
  const recordOffset = headerSize + recordIndex * recordSize;

  const changedFields = [];
  const skippedFields = [];
  for (const [fieldName, rawValue] of Object.entries(numericPatch)) {
    const fieldIdx = getFieldIndex(spellData.fieldDefs, fieldName);
    if (fieldIdx === -1) {
      skippedFields.push(fieldName);
      continue;
    }
    const byteOffset = recordOffset + fieldIdx * 4;
    if (byteOffset + 4 > recordsEnd) {
      skippedFields.push(fieldName);
      continue;
    }
    buffer.writeUInt32LE(toSigned32(rawValue) >>> 0, byteOffset);
    changedFields.push(fieldName);
  }

  if (!changedFields.length) {
    return { patched: false, reason: 'no-fields-matched', skippedFields };
  }

  fs.writeFileSync(liveDbcPath, buffer);

  // Keep the client export staging copy (what /api/spells/export serves,
  // and what resolveDbcPath() prefers once it exists) in sync too.
  const exportDbcDir = path.join(EXPORT_DIR, 'DBFilesClient');
  if (!fs.existsSync(exportDbcDir)) fs.mkdirSync(exportDbcDir, { recursive: true });
  fs.copyFileSync(liveDbcPath, path.join(exportDbcDir, 'Spell.dbc'));

  invalidateSpellCaches();

  return { patched: true, changedFields, skippedFields, recordIndex };
}

function buildSpellIconIndex(config) {
  const startTime = Date.now();
  const spellPath = resolveDbcPath(config, 'Spell.dbc');
  const spellIconPath = resolveDbcPath(config, 'SpellIcon.dbc');

  if (!fs.existsSync(spellPath) || !fs.existsSync(spellIconPath)) {
    console.log('⚠ Cannot build spell-icon index: DBC files not found');
    return null;
  }

  // Step 1: Parse SpellIcon.dbc → Map<spellIconId, iconBaseName>
  const iconBuffer = fs.readFileSync(spellIconPath);
  if (iconBuffer.length < 20 || iconBuffer.toString('utf-8', 0, 4) !== 'WDBC') return null;
  const iconView = new DataView(iconBuffer.buffer, iconBuffer.byteOffset, iconBuffer.byteLength);
  const iconRecordCount = iconView.getUint32(4, true);
  const iconRecordSize = iconView.getUint32(12, true);
  const iconHeaderSize = 20;
  const iconStringBlockOffset = iconHeaderSize + (iconRecordCount * iconRecordSize);

  const readIconString = (offset) => {
    if (offset === 0) return '';
    const start = iconStringBlockOffset + offset;
    let end = start;
    while (end < iconBuffer.length && iconBuffer[end] !== 0) end++;
    return iconBuffer.slice(start, end).toString('utf8');
  };

  const spellIconMap = new Map();
  for (let i = 0; i < iconRecordCount; i++) {
    const off = iconHeaderSize + (i * iconRecordSize);
    if (off + 8 > iconBuffer.length) continue; // bounds check
    const id = iconView.getUint32(off, true);
    let iconPath = readIconString(iconView.getUint32(off + 4, true));
    if (iconPath) {
      iconPath = iconPath.replace(/\\/g, '/');
      if (iconPath.includes('/')) iconPath = iconPath.substring(iconPath.lastIndexOf('/') + 1);
      iconPath = iconPath.replace(/\.[^.]+$/, '');
    }
    if (iconPath) spellIconMap.set(id, iconPath);
  }

  // Step 2: Parse Spell.dbc → Map<spellId, spellIconId>
  const spellBuffer = fs.readFileSync(spellPath);
  if (spellBuffer.length < 20 || spellBuffer.toString('utf-8', 0, 4) !== 'WDBC') return null;
  const spellView = new DataView(spellBuffer.buffer, spellBuffer.byteOffset, spellBuffer.byteLength);
  const spellRecordCount = spellView.getUint32(4, true);
  const spellRecordSize = spellView.getUint32(12, true);
  const spellHeaderSize = 20;

  // Step 3: Join into spellId → iconBaseName
  const index = {};
  const spellDataEnd = spellHeaderSize + (spellRecordCount * spellRecordSize);
  for (let i = 0; i < spellRecordCount; i++) {
    const off = spellHeaderSize + (i * spellRecordSize);
    try {
      if (off + 536 > spellDataEnd) continue; // safety: skip if offset 532 would read past records
      const spellId = spellView.getUint32(off, true);
      const spellIconId = spellView.getUint32(off + 532, true);
      const iconName = spellIconMap.get(spellIconId);
      if (iconName) index[spellId] = iconName;
    } catch (e) {
      // Skip records with offset issues
    }
  }

  // Step 4: Write to disk
  const meta = {
    builtAt: new Date().toISOString(),
    spellCount: Object.keys(index).length,
    spellDbc: { records: spellRecordCount, mtime: fs.statSync(spellPath).mtimeMs },
    spellIconDbc: { records: iconRecordCount, mtime: fs.statSync(spellIconPath).mtimeMs },
  };
  const payload = { meta, index };
  fs.writeFileSync(SPELL_ICON_INDEX_PATH, JSON.stringify(payload));

  const duration = Date.now() - startTime;
  console.log(`✓ Spell-icon index built: ${meta.spellCount} entries in ${duration}ms`);

  // Also populate in-memory cache
  dbcCache.spellIconIndex = index;
  return index;
}

// Load from disk or rebuild if stale
function loadOrBuildSpellIconIndex() {
  const config = loadConfigFile();
  const spellPath = resolveDbcPath(config, 'Spell.dbc');
  const spellIconPath = resolveDbcPath(config, 'SpellIcon.dbc');

  if (!fs.existsSync(spellPath) || !fs.existsSync(spellIconPath)) return null;

  // Check if index file exists and is newer than both DBC files
  if (fs.existsSync(SPELL_ICON_INDEX_PATH)) {
    const indexMtime = fs.statSync(SPELL_ICON_INDEX_PATH).mtimeMs;
    const spellMtime = fs.statSync(spellPath).mtimeMs;
    const iconMtime = fs.statSync(spellIconPath).mtimeMs;

    if (indexMtime > spellMtime && indexMtime > iconMtime) {
      try {
        const data = JSON.parse(fs.readFileSync(SPELL_ICON_INDEX_PATH, 'utf8'));
        dbcCache.spellIconIndex = data.index;
        console.log(`✓ Spell-icon index loaded from disk: ${data.meta.spellCount} entries (cached)`);
        return data.index;
      } catch (e) {
        console.log('⚠ Cached spell-icon index corrupt, rebuilding...');
      }
    } else {
      console.log('⚠ DBC files changed since last index, rebuilding...');
    }
  }

  return buildSpellIconIndex(config);
}

// ===== Spell-Name Index =====
// Builds a compact spellId → name mapping for search.
function buildSpellNameIndex(config) {
  const startTime = Date.now();
  const spellPath = resolveDbcPath(config, 'Spell.dbc');
  if (!fs.existsSync(spellPath)) {
    console.log('⚠ Cannot build spell-name index: Spell.dbc not found');
    return null;
  }

  let spellData;
  try {
    spellData = readDBC(spellPath);
  } catch (err) {
    console.error('⚠ Failed to read Spell.dbc for name index:', err.message);
    return null;
  }

  const idFieldIdx = spellData.fieldDefs.findIndex(fd => fd.name === 'ID');
  if (idFieldIdx === -1) {
    console.error('⚠ Spell.dbc definition missing ID field');
    return null;
  }

  const bestNameFieldIdx = selectBestSpellNameFieldIndex(spellData);
  if (bestNameFieldIdx === -1) {
    console.error('⚠ Spell.dbc has no string fields for spell-name index');
    return null;
  }
  const nameFieldIndices = getPreferredSpellNameFieldIndices(spellData, bestNameFieldIdx);

  if (!dbcCache.spellIconIndex) {
    try { loadOrBuildSpellIconIndex(); } catch (e) { /* ignore */ }
  }
  const spellIconIndex = dbcCache.spellIconIndex || {};

  const entries = [];
  for (const row of spellData.records) {
    const spellId = Number(row[idFieldIdx]);
    const name = pickSpellNameFromRow(row, nameFieldIndices);
    if (!spellId || !name) continue;
    const icon = spellIconIndex[spellId] || null;
    entries.push({ id: spellId, name, icon, nameLower: name.toLowerCase() });
  }

  const meta = {
    version: SPELL_NAME_INDEX_VERSION,
    builtAt: new Date().toISOString(),
    spellCount: entries.length,
    spellDbc: { mtime: fs.statSync(spellPath).mtimeMs },
    nameFields: nameFieldIndices.map((idx) => spellData.fieldDefs[idx]?.name || `Field_${idx}`),
    selectedField: spellData.fieldDefs[bestNameFieldIdx]?.name || `Field_${bestNameFieldIdx}`,
  };

  const payload = { meta, entries };
  fs.writeFileSync(SPELL_NAME_INDEX_PATH, JSON.stringify(payload));

  const duration = Date.now() - startTime;
  console.log(`✓ Spell-name index built: ${entries.length} entries in ${duration}ms`);

  dbcCache.spellNameIndex = entries;
  return entries;
}

function loadOrBuildSpellNameIndex() {
  const config = loadConfigFile();
  const spellPath = resolveDbcPath(config, 'Spell.dbc');

  if (!fs.existsSync(spellPath)) return null;

  if (fs.existsSync(SPELL_NAME_INDEX_PATH)) {
    try {
      const indexMtime = fs.statSync(SPELL_NAME_INDEX_PATH).mtimeMs;
      const spellMtime = fs.statSync(spellPath).mtimeMs;
      if (indexMtime > spellMtime) {
        const data = JSON.parse(fs.readFileSync(SPELL_NAME_INDEX_PATH, 'utf8'));
        if (Number(data?.meta?.version || 0) !== SPELL_NAME_INDEX_VERSION) {
          console.log('⚠ Spell-name index version changed, rebuilding...');
          return buildSpellNameIndex(config);
        }
        dbcCache.spellNameIndex = data.entries || [];
        console.log(`✓ Spell-name index loaded from disk: ${data.meta?.spellCount || dbcCache.spellNameIndex.length} entries (cached)`);
        return dbcCache.spellNameIndex;
      }
    } catch (e) {
      console.log('⚠ Cached spell-name index corrupt, rebuilding...');
    }
  }

  return buildSpellNameIndex(config);
}

function getCachedOrParse(cacheKey, filePath, parseFunction) {
  try {
    if (!fs.existsSync(filePath)) return null;
    
    const stats = fs.statSync(filePath);
    const mtime = stats.mtimeMs;
    
    // Check if file was modified
    if (dbcCache.lastModified[cacheKey] !== mtime) {
      dbcCache.lastModified[cacheKey] = mtime;
      const result = parseFunction(filePath);
      return result;
    }
    
    return null; // Cached version will be used
  } catch (err) {
    console.error(`Cache check failed for ${cacheKey}:`, err);
    return null;
  }
}

// Thumbnail generation system
const THUMBNAILS_DIR = path.join(PUBLIC_DIR, 'thumbnails');

async function ensureThumbnailsDir() {
  if (!fs.existsSync(THUMBNAILS_DIR)) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
  }
}

async function generateThumbnailsForIcons() {
  try {
    await ensureThumbnailsDir();
    const config = loadConfigFile();
    const iconDirName = getBaseIconDir(config);
    const iconDirPath = path.join(PUBLIC_DIR, iconDirName);
    const baseIconDir = config?.paths?.base?.icons || DEFAULT_CONFIG.paths.base.icons;
    const baseIconCandidates = [
      path.join(PUBLIC_DIR, baseIconDir),
      path.join(PUBLIC_DIR, String(baseIconDir).toLowerCase()),
      path.join(PUBLIC_DIR, 'icon'),
      path.join(PUBLIC_DIR, 'Icon'),
      path.join(PUBLIC_DIR, 'Icons'),
    ];
    const baseIconPath = baseIconCandidates.find(p => fs.existsSync(p)) || null;

    if (!fs.existsSync(iconDirPath)) {
      console.log(`Icon directory not found: ${iconDirPath}`);
      return { generated: 0, skipped: 0, failed: 0 };
    }

    const files = fs.readdirSync(iconDirPath).filter(f => f.toLowerCase().endsWith('.blp'));
    let generated = 0, skipped = 0, failed = 0;

    for (const file of files) {
      try {
        const iconPath = path.join(iconDirPath, file);
        const thumbnailPath = path.join(THUMBNAILS_DIR, file.replace(/\.blp$/i, '.png'));
        
        // Skip if thumbnail already exists and is non-empty
        if (fs.existsSync(thumbnailPath)) {
          const thumbSize = fs.statSync(thumbnailPath).size;
          if (thumbSize > 0) {
            skipped++;
            continue;
          }
        }

        let sourcePath = iconPath;
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

        const blpData = fs.readFileSync(sourcePath);
        
        // Decode BLP file using BLPFile decoder
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
      } catch (err) {
        console.error(`Failed to generate thumbnail for ${file}:`, err.message);
        failed++;
      }
    }

    console.log(`Thumbnail generation: ${generated} generated, ${skipped} skipped, ${failed} failed`);
    return { generated, skipped, failed };
  } catch (err) {
    console.error('Thumbnail generation failed:', err);
    logErrorToFile(`Thumbnail generation failed: ${err.stack || err}`);
    return { generated: 0, skipped: 0, failed: 0 };
  }
}

// Debug: Get all talent tree IDs and how many talents in each
app.get('/api/debug/talent-trees', (req, res) => {
  try {
    const config = loadConfigFile();
    const talentPath = resolveDbcPath(config, 'Talent.dbc');
    const talentTabPath = resolveDbcPath(config, 'TalentTab.dbc');
    
    if (!fs.existsSync(talentPath)) {
      return res.status(404).json({ error: 'Talent.dbc not found' });
    }

    // Parse TalentTab.dbc to get spec names
    const tabNames = fs.existsSync(talentTabPath) ? parseTalentTabDBC(talentTabPath) : {};

    const buffer = fs.readFileSync(talentPath);
    if (buffer.length < 20) {
      return res.status(400).json({ error: 'Invalid Talent.dbc' });
    }

    const magic = buffer.toString('utf-8', 0, 4);
    if (magic !== 'WDBC') {
      return res.status(400).json({ error: 'Invalid DBC format' });
    }

    const recordCount = buffer.readUInt32LE(4);
    const recordSize = buffer.readUInt32LE(12);
    const headerSize = 20;
    const recordsOffset = headerSize;

    // Group talents by TabId
    const talentsByTabId = {};
    
    for (let i = 0; i < recordCount; i++) {
      const offset = recordsOffset + (i * recordSize);
      if (offset + 8 > buffer.length) break;
      
      try {
        const tabId = buffer.readUInt32LE(offset + 4);
        talentsByTabId[tabId] = (talentsByTabId[tabId] || 0) + 1;
      } catch (e) {
        // Skip errors
      }
    }

    res.json({
      message: 'Talent tree IDs found in Talent.dbc',
      totalTalents: recordCount,
      tabIds: talentsByTabId,
      tabIdsSorted: Object.keys(talentsByTabId).map(Number).sort((a, b) => a - b),
      tabNames: tabNames, // Add spec names from TalentTab.dbc
      currentMapping: classToTabMapping,
    });
  } catch (err) {
    console.error('Debug error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to get talent tab names from TalentTab.dbc (with caching)
app.get('/api/talent-tab-names', (req, res) => {
  try {
    const cfg = loadDeployedTalentConfig();
    if (cfg) {
      try {
        const classes = cfg?.classes || {};
        const tabNamesFromJson = {};

        for (const [className, tabIds] of Object.entries(classToTabMapping)) {
          const classId = classNameToClassId[className];
          const classCfg = classes[classId] || classes[String(classId)];
          const specs = Array.isArray(classCfg?.specs) ? classCfg.specs : [];
          const tabs = classCfg && classCfg.tabs && typeof classCfg.tabs === 'object' ? classCfg.tabs : null;
          const tabCount = Math.max(
            tabIds.length,
            specs.length,
            tabs ? Object.keys(tabs).length : 0
          );

          for (let i = 0; i < tabCount; i++) {
            const mappedTabId = tabIds[i] || 0;
            const spec = specs[i];
            const tab = tabs ? tabs[String(i + 1)] || tabs[i + 1] : null;
            const tabId = Number(tab?.tabId || mappedTabId || 0);
            if (!tabId) continue;
            if (spec && typeof spec.name === 'string' && spec.name.trim()) {
              tabNamesFromJson[tabId] = spec.name.trim();
            } else if (tab && typeof tab.name === 'string' && tab.name.trim()) {
              tabNamesFromJson[tabId] = tab.name.trim();
            }
          }
        }

        if (Object.keys(tabNamesFromJson).length > 0) {
          return res.json({
            tabNames: tabNamesFromJson,
            classToTabMapping,
            source: 'json',
          });
        }
      } catch (jsonErr) {
        console.warn('Talent tab names JSON read failed, falling back to DBC:', jsonErr.message);
      }
    }

    const config = loadConfigFile();
    const talentTabPath = resolveDbcPath(config, 'TalentTab.dbc');
    
    if (!fs.existsSync(talentTabPath)) {
      return res.status(404).json({ error: 'TalentTab.dbc not found' });
    }

    // Use cached or parse TalentTab.dbc
    if (!dbcCache.tabNames || getCachedOrParse('talentTabDbc', talentTabPath, () => true)) {
      dbcCache.tabNames = parseTalentTabDBC(talentTabPath);
    }
    
    // Add cache headers (1 hour - tab names rarely change)
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      tabNames: dbcCache.tabNames,
      classToTabMapping,
    });
  } catch (err) {
    console.error('Error reading talent tab names:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to get talents for a class with icon paths (with caching)
app.get('/api/talents/:className', (req, res) => {
  const startTime = Date.now();
  
  try {
    const { className } = req.params;
    const classKey = className.toLowerCase();
    const tabIds = classToTabMapping[classKey] || [];
    const classId = classNameToClassId[classKey];

    if (!classId && tabIds.length === 0) {
      return res.json({ 
        talents: [],
        specs: [
          { tabId: 0, talents: [] },
          { tabId: 1, talents: [] },
          { tabId: 2, talents: [] },
        ]
      });
    }

    const cfg = loadDeployedTalentConfig();
    if (cfg) {
      try {
        const classCfg = cfg?.classes?.[classId] || cfg?.classes?.[String(classId)];
        const specsCfg = Array.isArray(classCfg?.specs) ? classCfg.specs : null;
        const tabsCfg = classCfg && classCfg.tabs && typeof classCfg.tabs === 'object' ? classCfg.tabs : null;

        if ((specsCfg && specsCfg.length > 0) || tabsCfg) {
          if (!dbcCache.spellIconIndex) {
            try { loadOrBuildSpellIconIndex(); } catch (e) {
              console.error('⚠ Spell-icon index build failed (non-fatal):', e.message);
            }
          }
          const spellIconIndex = dbcCache.spellIconIndex || {};

          const spriteMapPath = path.join(PUBLIC_DIR, 'sprites', 'sprite-map.json');
          let spriteMap = null;
          if (fs.existsSync(spriteMapPath)) {
            try {
              spriteMap = JSON.parse(fs.readFileSync(spriteMapPath, 'utf8'));
            } catch (e) { /* ignore */ }
          }

          const sourceSpecs = (specsCfg && specsCfg.length > 0)
            ? specsCfg.slice(0, MAX_CLASS_SPECS).map((spec, idx) => ({
                spec,
                tabIdx: idx + 1,
                tab: tabsCfg ? tabsCfg[String(idx + 1)] || tabsCfg[idx + 1] : null,
              }))
            : Object.keys(tabsCfg || {})
                .map(Number)
                .filter((idx) => Number.isFinite(idx))
                .sort((a, b) => a - b)
                .slice(0, MAX_CLASS_SPECS)
                .map((tabIdx) => ({
                  spec: null,
                  tabIdx,
                  tab: tabsCfg[String(tabIdx)] || tabsCfg[tabIdx] || null,
                }));

          const specs = sourceSpecs.map(({ spec, tabIdx, tab }) => {
            const tabId = Number(tab?.tabId || tabIds[tabIdx - 1] || (10000 + ((classId || 0) * 10) + tabIdx));
            const specTalents = spec
              ? (Array.isArray(spec?.talents) ? spec.talents : [])
              : Object.entries(tab?.talents || {}).map(([id, value]) => ({ id: Number(id), ...(value || {}) }));

            const classTalents = spec && classCfg && classCfg.classTree && Array.isArray(classCfg.classTree.talents)
              ? classCfg.classTree.talents
              : [];

            const heroTrees = spec && Array.isArray(spec.heroTrees) ? spec.heroTrees : [];
            const hero1Talents = heroTrees[0] && Array.isArray(heroTrees[0].talents) ? heroTrees[0].talents : [];
            const hero2Talents = heroTrees[1] && Array.isArray(heroTrees[1].talents) ? heroTrees[1].talents : [];

            const specCols = Math.max(1, Number(spec?.cols || SPEC_DEFAULT_COLS));
            const heroColStart = SPEC_COL_START + specCols;

            const flatTalents = [];

            for (const t of classTalents) {
              flatTalents.push({
                ...(t || {}),
                row: Number(t?.row || 1),
                col: Number(t?.col || 1),
              });
            }

            for (const t of specTalents) {
              flatTalents.push({
                ...(t || {}),
                row: Number(t?.row || 1),
                col: Number(t?.col || 1) + SPEC_COL_START,
              });
            }

            for (const t of hero1Talents) {
              flatTalents.push({
                ...(t || {}),
                row: Number(t?.row || 1),
                col: Number(t?.col || 1) + heroColStart,
              });
            }

            for (const t of hero2Talents) {
              flatTalents.push({
                ...(t || {}),
                row: Number(t?.row || 1) + HERO2_ROW_START,
                col: Number(t?.col || 1) + heroColStart,
              });
            }

            const talents = flatTalents
              .map((t) => {
                const spells = Array.isArray(t?.spells) ? t.spells.map(Number) : [];
                const spellId = Number(spells[0] || 0);
                const iconPath = spellIconIndex[spellId] || null;

                let sprite = null;
                if (spriteMap && iconPath) {
                  const classIcons = spriteMap.classes?.[className];
                  if (classIcons) {
                    let entry = classIcons[iconPath];
                    if (!entry) {
                      const lowerPath = iconPath.toLowerCase();
                      const matchKey = Object.keys(classIcons).find(
                        k => k.toLowerCase() === lowerPath
                      );
                      if (matchKey) entry = classIcons[matchKey];
                    }
                    if (entry) {
                      sprite = {
                        sheet: className,
                        x: entry.x,
                        y: entry.y,
                      };
                    }
                  }
                }

                const prereqs = Array.isArray(t?.prereqs) ? t.prereqs : [];
                return {
                  id: Number(t?.id || 0),
                  tabId,
                  row: Math.max(0, Number(t?.row || 1) - 1),
                  column: Math.max(0, Number(t?.col || 1) - 1),
                  spellId,
                  spellRanks: spells,
                  maxRank: Number(t?.maxRank || spells.length || 1),
                  mastery: !!t?.mastery,
                  prereqTalents: prereqs.map((p) => Number(p?.id || 0)),
                  prereqRanks: prereqs.map((p) => Number(p?.rank || 0)),
                  iconPath,
                  sprite,
                };
              })
              .filter((t) => t.id > 0)
              .sort((a, b) => a.row - b.row || a.column - b.column);

            const specName = (spec && typeof spec.name === 'string' && spec.name.trim())
              || (tab && typeof tab.name === 'string' && tab.name.trim())
              || `Spec ${tabIdx}`;
            const specRows = Math.max(1, Number(spec?.rows || SPEC_DEFAULT_ROWS));
            const heroCols = SIDE_TREE_COLS;

            return {
              tabId,
              name: specName,
              rows: specRows,
              cols: specCols,
              talents,
              // Zone layout describing the shared combined-column coordinate space
              // (matches Talent Editor's class-tree/spec-tree/hero-tree flattening),
              // so consumers don't have to hardcode a fixed 4-col/11-row grid.
              layout: {
                classCols: SIDE_TREE_COLS,
                specColStart: SPEC_COL_START,
                specCols,
                heroColStart,
                heroCols,
                mainRows: specRows,
                hero1RowStart: 0,
                hero1Rows: SIDE_TREE_ROWS,
                hero2RowStart: HERO2_ROW_START,
                hero2Rows: SIDE_TREE_ROWS,
                totalCols: heroColStart + heroCols,
                totalRows: Math.max(specRows, HERO2_ROW_START + SIDE_TREE_ROWS),
              },
            };
          }).slice(0, MAX_CLASS_SPECS);

          const duration = Date.now() - startTime;
          console.log(`Talents API [${className}] JSON: ${duration}ms`);
          res.set('Cache-Control', 'no-store');
          return res.json({
            className,
            specs,
            source: 'json',
            spriteSheet: `/sprites/${className.toLowerCase()}.png`,
            spriteIconSize: spriteMap?.iconSize || 64,
            spriteIconsPerRow: spriteMap?.iconsPerRow || 16,
          });
        }
      } catch (jsonErr) {
        console.warn(`Talents API [${className}] JSON read failed, falling back to DBC:`, jsonErr.message);
      }
    }

    const config = loadConfigFile();
    const talentPath = resolveDbcPath(config, 'Talent.dbc');
    
    // Use cached or parse Talent.dbc
    if (!dbcCache.talents || getCachedOrParse('talentDbc', talentPath, () => true)) {
      dbcCache.talents = parseTalentDBC(talentPath);
    }
    const allTalents = dbcCache.talents;

    // Use pre-built spell-icon index (spellId → iconBaseName directly)
    if (!dbcCache.spellIconIndex) {
      try { loadOrBuildSpellIconIndex(); } catch (e) {
        console.error('⚠ Spell-icon index build failed (non-fatal):', e.message);
      }
    }
    const spellIconIndex = dbcCache.spellIconIndex || {};

    // Load sprite map for this class
    const spriteMapPath = path.join(PUBLIC_DIR, 'sprites', 'sprite-map.json');
    let spriteMap = null;
    if (fs.existsSync(spriteMapPath)) {
      try {
        spriteMap = JSON.parse(fs.readFileSync(spriteMapPath, 'utf8'));
      } catch (e) { /* ignore */ }
    }

    // Enrich talents with icon paths and sprite coordinates
    const enrichedTalents = allTalents.map(talent => {
      // Direct lookup from pre-built index (no two-step DBC join needed)
      let iconPath = spellIconIndex[talent.spellId] || null;
      
      // Look up sprite coordinates from per-class mapping
      let sprite = null;
      if (spriteMap && iconPath) {
        const classIcons = spriteMap.classes?.[className];
        if (classIcons) {
          // Try exact match first
          let entry = classIcons[iconPath];
          
          // Fallback: case-insensitive match
          if (!entry) {
            const lowerPath = iconPath.toLowerCase();
            const matchKey = Object.keys(classIcons).find(
              k => k.toLowerCase() === lowerPath
            );
            if (matchKey) entry = classIcons[matchKey];
          }
          
          if (entry) {
            sprite = {
              sheet: className, // always the current class's sprite sheet
              x: entry.x,
              y: entry.y,
            };
          }
        }
      }
      
      return {
        ...talent,
        iconPath,
        sprite,
      };
    });

    // Group talents by tab (spec) using the tabIds for this class
    const specs = tabIds.map((tabId, specIdx) => {
      const specTalents = enrichedTalents
        .filter(t => t.tabId === tabId)
        .sort((a, b) => a.row - b.row || a.column - b.column);

      return {
        tabId,
        talents: specTalents,
      };
    });

    const duration = Date.now() - startTime;
    console.log(`Talents API [${className}]: ${duration}ms`);
    
    // Add cache headers (5 minutes)
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ 
      className,
      specs,
      spriteSheet: `/sprites/${className.toLowerCase()}.png`,
      spriteIconSize: spriteMap?.iconSize || 64,
      spriteIconsPerRow: spriteMap?.iconsPerRow || 16,
    });
  } catch (error) {
    console.error('Error fetching talents:', error);
    logErrorToFile(`Error fetching talents: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Get sprite map for optimized icon loading
app.get('/api/sprite-map', (req, res) => {
  try {
    const spriteMapPath = path.join(PUBLIC_DIR, 'sprites', 'sprite-map.json');
    if (!fs.existsSync(spriteMapPath)) {
      return res.status(404).json({ 
        error: 'Sprite map not found. Sprites may still be generating.'
      });
    }
    const spriteMap = JSON.parse(fs.readFileSync(spriteMapPath, 'utf8'));
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.json(spriteMap);
  } catch (err) {
    console.error('Failed to read sprite map:', err);
    res.status(500).json({ error: 'Failed to read sprite map' });
  }
});

// ===== Talent Editor API Endpoints =====

// Save modified talents back to Talent.dbc
app.post('/api/talents/save', (req, res) => {
  try {
    const { talents } = req.body;
    if (!talents || !Array.isArray(talents)) {
      return res.status(400).json({ error: 'Missing talents array' });
    }

    const config = loadConfigFile();
    const talentPath = resolveDbcPath(config, 'Talent.dbc');

    if (!fs.existsSync(talentPath)) {
      return res.status(404).json({ error: 'Talent.dbc not found' });
    }

    // Read existing file to preserve header and record structure
    const buffer = Buffer.from(fs.readFileSync(talentPath));
    const magic = buffer.toString('utf-8', 0, 4);
    if (magic !== 'WDBC') {
      return res.status(400).json({ error: 'Invalid Talent.dbc format' });
    }

    const recordCount = buffer.readUInt32LE(4);
    const recordSize = buffer.readUInt32LE(12);
    const headerSize = 20;

    // Build a map of existing record positions by talent ID
    const idToOffset = new Map();
    for (let i = 0; i < recordCount; i++) {
      const offset = headerSize + (i * recordSize);
      const id = buffer.readUInt32LE(offset);
      idToOffset.set(id, offset);
    }

    // Apply edits to the buffer
    let modified = 0;
    for (const talent of talents) {
      const offset = idToOffset.get(talent.id);
      if (offset === undefined) {
        console.warn(`Talent ID ${talent.id} not found in DBC, skipping`);
        continue;
      }

      // Write all 23 fields
      buffer.writeUInt32LE(talent.id, offset);
      buffer.writeUInt32LE(talent.tabId, offset + 4);
      buffer.writeUInt32LE(talent.row, offset + 8);
      buffer.writeUInt32LE(talent.column, offset + 12);

      // Spell ranks (9 slots)
      const ranks = talent.spellRanks || [talent.spellId || 0];
      for (let r = 0; r < 9; r++) {
        buffer.writeUInt32LE(ranks[r] || 0, offset + 16 + r * 4);
      }

      // Prereq talents (3 slots)
      const prereqs = talent.prereqTalents || [0, 0, 0];
      for (let p = 0; p < 3; p++) {
        buffer.writeUInt32LE(prereqs[p] || 0, offset + 52 + p * 4);
      }

      // Prereq ranks (3 slots)
      const prereqRanks = talent.prereqRanks || [0, 0, 0];
      for (let p = 0; p < 3; p++) {
        buffer.writeUInt32LE(prereqRanks[p] || 0, offset + 64 + p * 4);
      }

      buffer.writeUInt32LE(talent.flags || 0, offset + 76);
      buffer.writeUInt32LE(talent.requiredSpellId || 0, offset + 80);

      const petFlags = talent.petFlags || [0, 0];
      buffer.writeUInt32LE(petFlags[0] || 0, offset + 84);
      buffer.writeUInt32LE(petFlags[1] || 0, offset + 88);

      modified++;
    }

    // Backup original before writing
    const backupPath = talentPath + '.bak';
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(talentPath, backupPath);
      console.log('Created Talent.dbc backup');
    }

    // Write modified buffer to export folder (edited output)
    const exportDir = path.join(EXPORT_DIR, 'DBFilesClient');
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
    const exportPath = path.join(exportDir, 'Talent.dbc');
    fs.writeFileSync(exportPath, buffer);

    // Invalidate DBC cache
    dbcCache.talents = null;
    if (dbcCache.lastModified) dbcCache.lastModified.talentDbc = 0;

    console.log(`Talent.dbc saved: ${modified} talents modified (written to ${exportPath})`);
    res.json({ success: true, modified, total: recordCount });
  } catch (error) {
    console.error('Error saving Talent.dbc:', error);
    logErrorToFile(`Error saving Talent.dbc: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Add a new talent record to Talent.dbc
app.post('/api/talents/add', (req, res) => {
  try {
    const { tabId, row, column, spellId, spellRanks, prereqTalents, prereqRanks, flags, requiredSpellId, petFlags } = req.body;
    if (tabId === undefined || row === undefined || column === undefined) {
      return res.status(400).json({ error: 'Missing tabId, row, or column' });
    }

    const config = loadConfigFile();
    const talentPath = resolveDbcPath(config, 'Talent.dbc');

    if (!fs.existsSync(talentPath)) {
      return res.status(404).json({ error: 'Talent.dbc not found' });
    }

    const oldBuffer = fs.readFileSync(talentPath);
    const magic = oldBuffer.toString('utf-8', 0, 4);
    if (magic !== 'WDBC') {
      return res.status(400).json({ error: 'Invalid Talent.dbc format' });
    }

    const recordCount = oldBuffer.readUInt32LE(4);
    const fieldCount = oldBuffer.readUInt32LE(8);
    const recordSize = oldBuffer.readUInt32LE(12);
    const stringBlockSize = oldBuffer.readUInt32LE(16);
    const headerSize = 20;

    // Find the highest existing talent ID
    let maxId = 0;
    for (let i = 0; i < recordCount; i++) {
      const offset = headerSize + (i * recordSize);
      const id = oldBuffer.readUInt32LE(offset);
      if (id > maxId) maxId = id;
    }
    const newId = maxId + 1;

    // Backup before modifying
    const backupPath = talentPath + '.bak';
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(talentPath, backupPath);
      console.log('Created Talent.dbc backup');
    }

    // Create new buffer: old data + 1 new record
    const recordsEnd = headerSize + (recordCount * recordSize);
    const stringBlock = oldBuffer.slice(recordsEnd);
    const newBuffer = Buffer.alloc(headerSize + ((recordCount + 1) * recordSize) + stringBlock.length);

    // Copy header
    oldBuffer.copy(newBuffer, 0, 0, headerSize);
    // Update record count
    newBuffer.writeUInt32LE(recordCount + 1, 4);

    // Copy existing records
    oldBuffer.copy(newBuffer, headerSize, headerSize, recordsEnd);

    // Write new record at end of record block
    // Fields: id, tabId, row, col, spellRank[9], prereqTalent[3], prereqRank[3], flags, requiredSpellId, petFlags[2]
    const newOffset = headerSize + (recordCount * recordSize);
    const ranks = spellRanks || [spellId || 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const prereqs = prereqTalents || [0, 0, 0];
    const preReqRanks = prereqRanks || [0, 0, 0];
    const pFlags = petFlags || [0, 0];

    newBuffer.writeUInt32LE(newId, newOffset);              // 0: ID
    newBuffer.writeUInt32LE(tabId, newOffset + 4);           // 1: TabID
    newBuffer.writeUInt32LE(row, newOffset + 8);             // 2: TierID (row)
    newBuffer.writeUInt32LE(column, newOffset + 12);         // 3: ColumnIndex
    for (let i = 0; i < 9; i++) {
      newBuffer.writeUInt32LE(ranks[i] || 0, newOffset + 16 + (i * 4)); // 4-12: SpellRank[0-8]
    }
    for (let i = 0; i < 3; i++) {
      newBuffer.writeUInt32LE(prereqs[i] || 0, newOffset + 52 + (i * 4)); // 13-15: PrereqTalent[0-2]
    }
    for (let i = 0; i < 3; i++) {
      newBuffer.writeUInt32LE(preReqRanks[i] || 0, newOffset + 64 + (i * 4)); // 16-18: PrereqRank[0-2]
    }
    newBuffer.writeUInt32LE(flags || 0, newOffset + 76);      // 19: Flags
    newBuffer.writeUInt32LE(requiredSpellId || 0, newOffset + 80); // 20: RequiredSpellId
    for (let i = 0; i < 2; i++) {
      newBuffer.writeUInt32LE(pFlags[i] || 0, newOffset + 84 + (i * 4)); // 21-22: PetFlags
    }

    // Copy string block after new records
    stringBlock.copy(newBuffer, headerSize + ((recordCount + 1) * recordSize));

    // Write to export folder
    const exportDir = path.join(EXPORT_DIR, 'DBFilesClient');
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
    const exportPath = path.join(exportDir, 'Talent.dbc');
    fs.writeFileSync(exportPath, newBuffer);

    // Invalidate cache
    dbcCache.talents = null;
    if (dbcCache.lastModified) dbcCache.lastModified.talentDbc = 0;

    console.log(`Added new talent #${newId} to tab ${tabId} at R${row}C${column} (written to ${exportPath})`);
    res.json({ success: true, id: newId, tabId, row, column });
  } catch (error) {
    console.error('Error adding talent:', error);
    logErrorToFile(`Error adding talent: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Export Talent.dbc - download a copy
app.get('/api/talents/export', (req, res) => {
  try {
    const config = loadConfigFile();
    const talentPath = resolveDbcPath(config, 'Talent.dbc');

    if (!fs.existsSync(talentPath)) {
      return res.status(404).json({ error: 'Talent.dbc not found' });
    }

    res.download(talentPath, 'Talent.dbc');
  } catch (error) {
    console.error('Error exporting Talent.dbc:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a talent record from Talent.dbc
app.post('/api/talents/delete', (req, res) => {
  try {
    const { talentId } = req.body;
    if (!talentId) {
      return res.status(400).json({ error: 'Missing talentId' });
    }

    const config = loadConfigFile();
    const talentPath = resolveDbcPath(config, 'Talent.dbc');

    if (!fs.existsSync(talentPath)) {
      return res.status(404).json({ error: 'Talent.dbc not found' });
    }

    const oldBuffer = fs.readFileSync(talentPath);
    const magic = oldBuffer.toString('utf-8', 0, 4);
    if (magic !== 'WDBC') {
      return res.status(400).json({ error: 'Invalid Talent.dbc format' });
    }

    const recordCount = oldBuffer.readUInt32LE(4);
    const recordSize = oldBuffer.readUInt32LE(12);
    const headerSize = 20;
    const recordsEnd = headerSize + (recordCount * recordSize);
    const stringBlock = oldBuffer.slice(recordsEnd);

    // Find the record to delete
    let foundIndex = -1;
    for (let i = 0; i < recordCount; i++) {
      const offset = headerSize + (i * recordSize);
      const id = oldBuffer.readUInt32LE(offset);
      if (id === talentId) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1) {
      return res.status(404).json({ error: `Talent ID ${talentId} not found in DBC` });
    }

    // Backup before modifying
    const backupPath = talentPath + '.bak';
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(talentPath, backupPath);
      console.log('Created Talent.dbc backup');
    }

    // Build new buffer without the deleted record
    const newRecordCount = recordCount - 1;
    const newBuffer = Buffer.alloc(headerSize + (newRecordCount * recordSize) + stringBlock.length);

    // Copy header and update record count
    oldBuffer.copy(newBuffer, 0, 0, headerSize);
    newBuffer.writeUInt32LE(newRecordCount, 4);

    // Copy records before the deleted one
    const deleteOffset = headerSize + (foundIndex * recordSize);
    if (foundIndex > 0) {
      oldBuffer.copy(newBuffer, headerSize, headerSize, deleteOffset);
    }

    // Copy records after the deleted one
    const afterOffset = deleteOffset + recordSize;
    if (afterOffset < recordsEnd) {
      oldBuffer.copy(newBuffer, deleteOffset, afterOffset, recordsEnd);
    }

    // Copy string block
    stringBlock.copy(newBuffer, headerSize + (newRecordCount * recordSize));

    // Write to export folder
    const exportDir = path.join(EXPORT_DIR, 'DBFilesClient');
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(path.join(exportDir, 'Talent.dbc'), newBuffer);

    // Invalidate cache
    dbcCache.talents = null;
    if (dbcCache.lastModified) dbcCache.lastModified.talentDbc = 0;

    console.log(`Deleted talent #${talentId} from Talent.dbc (${newRecordCount} records remain)`);
    res.json({ success: true, deletedId: talentId, remainingRecords: newRecordCount });
  } catch (error) {
    console.error('Error deleting talent:', error);
    logErrorToFile(`Error deleting talent: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// ── Repack Talent.dbc + generate Lua coordinate table ──────────────────
// The 3.3.5a WoW client has a hardcoded limit: ColumnIndex >= 4 causes
// talents to silently fail.  This endpoint repacks all talent DBC coords
// into valid ranges (cols 0-3) and generates a Lua coordinate override
// table that the SurrealTalentFrame addon uses for display positioning.
const LUA_SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', '..', 'lua_scripts');
const LUA_SCRIPTS_RUNTIME_DIR = path.join(__dirname, '..', '..', '..', 'env', 'dist', 'bin', 'lua_scripts');

// WoW class tokens used by UnitClass("player") in Lua
const CLASS_ID_TO_TOKEN = {
  1: 'WARRIOR', 2: 'PALADIN', 3: 'HUNTER', 4: 'ROGUE',
  5: 'PRIEST', 6: 'DEATHKNIGHT', 7: 'SHAMAN', 8: 'MAGE',
  9: 'WARLOCK', 11: 'DRUID',
};

// ═══════════════════════════════════════════════════════════════════════
//  CUSTOM TALENT CONFIG SYSTEM (JSON-based, no DBC dependency)
// ═══════════════════════════════════════════════════════════════════════
// Talent tree data is stored as talent-config.json.
// The editor reads/writes that file.  "Deploy" generates the Lua config
// file (SurrealTalentConfig_AIO.lua) used by both server and client.
// ═══════════════════════════════════════════════════════════════════════

const TALENT_CONFIG_PATH = path.join(__dirname, 'talent-config.json');
// Snapshot of talent-config.json taken at the moment "Deploy to Server" is
// last clicked (POST /api/talent-config/deploy writes this). Spec Builder
// reads THIS file (see loadDeployedTalentConfig()) instead of the live config
// so its layout only changes when the author explicitly deploys, not on every
// live edit/autosave in Talent Editor. Talent Editor itself still reads/writes
// TALENT_CONFIG_PATH directly (unaffected — edits show up there immediately).
const TALENT_DEPLOYED_PATH = path.join(__dirname, 'talent-config.deployed.json');
const TALENT_WIPE_PATH = path.join(LUA_SCRIPTS_DIR, 'SurrealTalentWipe.lua');

// Falls back to the live config only if nothing has ever been deployed yet
// (first-run bootstrap) so Spec Builder isn't just empty before the first deploy.
function loadDeployedTalentConfig() {
  const sourcePath = fs.existsSync(TALENT_DEPLOYED_PATH) ? TALENT_DEPLOYED_PATH : TALENT_CONFIG_PATH;
  if (!fs.existsSync(sourcePath)) return null;
  return JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
}

const CLASS_ID_MAP = {
  1: 'WARRIOR', 2: 'PALADIN', 3: 'HUNTER', 4: 'ROGUE',
  5: 'PRIEST', 6: 'DEATHKNIGHT', 7: 'SHAMAN', 8: 'MAGE',
  9: 'WARLOCK', 11: 'DRUID',
};

const TAB_NAMES = {
  161: 'Arms', 164: 'Fury', 163: 'Protection',
  381: 'Holy', 382: 'Protection', 383: 'Retribution',
  361: 'Beast Mastery', 362: 'Marksmanship', 363: 'Survival',
  181: 'Assassination', 182: 'Combat', 183: 'Subtlety',
  201: 'Discipline', 202: 'Holy', 203: 'Shadow',
  398: 'Blood', 399: 'Frost', 400: 'Unholy',
  261: 'Elemental', 262: 'Enhancement', 263: 'Restoration',
  41: 'Arcane', 61: 'Fire', 81: 'Frost',
  301: 'Affliction', 302: 'Demonology', 303: 'Destruction',
  281: 'Balance', 282: 'Feral Combat', 283: 'Restoration',
};

const CLASS_TAB_ORDER = {
  1:  [161, 164, 163],
  2:  [381, 382, 383],
  3:  [361, 362, 363],
  4:  [181, 182, 183],
  5:  [201, 202, 203],
  6:  [398, 399, 400],
  7:  [261, 262, 263],
  8:  [41,  61,  81],
  9:  [301, 302, 303],
  11: [281, 282, 283],
};

const SPEC_DEFAULT_ROWS = 11;
const SPEC_DEFAULT_COLS = 7;
const MAX_CLASS_SPECS = 5;
const SIDE_TREE_ROWS = 5;
const SIDE_TREE_COLS = 3;
const SPEC_COL_START = 3; // spec grid starts at global col 4
const HERO2_ROW_START = 5;

function normalizeTalentConfig(rawConfig) {
  const rawClasses = (rawConfig && rawConfig.classes) || {};
  const classes = {};

  for (const [classIdStr, cls] of Object.entries(rawClasses)) {
    const classId = Number(classIdStr);
    const className = cls.className || CLASS_ID_MAP[classId] || 'UNKNOWN';

    if (cls.tabs) {
      classes[classId] = { className, tabs: cls.tabs };
      continue;
    }

    const specs = Array.isArray(cls.specs) ? cls.specs.slice(0, MAX_CLASS_SPECS) : [];
    const classTree = cls.classTree && Array.isArray(cls.classTree.talents)
      ? cls.classTree.talents
      : [];
    const includeSharedClassTree = cls.enableSharedClassTree !== false && classTree.length > 0;

    const tabs = {};
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i] || {};
      const tabIdx = i + 1;
      const specCols = Number(spec.cols || SPEC_DEFAULT_COLS);
      const heroColStart = SPEC_COL_START + specCols;
      const talents = {};

      const addTalent = (t, row, col, fallbackId) => {
        const requestedId = Number(t.id || fallbackId);
        let id = Number.isFinite(requestedId) && requestedId > 0 ? requestedId : Number(fallbackId);
        if (!Number.isFinite(id) || id <= 0) {
          id = (classId * 100000) + (tabIdx * 1000) + 900;
        }

        // Keep every placement; do not let duplicate talent IDs overwrite earlier zones.
        // This preserves shared class-tree entries even if spec/hero trees reuse IDs.
        while (talents[id]) {
          id += 1;
        }

        talents[id] = {
          row: Number(row || 1),
          col: Number(col || 1),
          maxRank: Number(t.maxRank || (Array.isArray(t.spells) ? t.spells.length : 0)),
          spells: Array.isArray(t.spells) ? t.spells.map(Number) : [],
          prereqs: Array.isArray(t.prereqs) ? t.prereqs : undefined,
          flags: t.flags || undefined,
          mastery: !!t.mastery,
        };
      };

      // Class tree (shared across all specs)
      if (includeSharedClassTree) {
        for (let ti = 0; ti < classTree.length; ti++) {
          const t = classTree[ti] || {};
          const fallbackId = (classId * 100000) + (tabIdx * 1000) + (ti + 1);
          addTalent(t, t.row, t.col, fallbackId);
        }
      }

      // Spec grid
      const specTalents = Array.isArray(spec.talents) ? spec.talents : [];
      for (let ti = 0; ti < specTalents.length; ti++) {
        const t = specTalents[ti] || {};
        const fallbackId = (classId * 100000) + (tabIdx * 1000) + (ti + 1);
        addTalent(t, t.row, (Number(t.col || 1) + SPEC_COL_START), fallbackId);
      }

      // Hero trees
      const heroTrees = Array.isArray(spec.heroTrees) ? spec.heroTrees : [];
      const hero1 = heroTrees[0] && Array.isArray(heroTrees[0].talents) ? heroTrees[0].talents : [];
      const hero2 = heroTrees[1] && Array.isArray(heroTrees[1].talents) ? heroTrees[1].talents : [];

      for (let ti = 0; ti < hero1.length; ti++) {
        const t = hero1[ti] || {};
        const fallbackId = (classId * 100000) + (tabIdx * 1000) + (200 + ti + 1);
        addTalent(t, t.row, (Number(t.col || 1) + heroColStart), fallbackId);
      }

      for (let ti = 0; ti < hero2.length; ti++) {
        const t = hero2[ti] || {};
        const fallbackId = (classId * 100000) + (tabIdx * 1000) + (400 + ti + 1);
        addTalent(t, (Number(t.row || 1) + HERO2_ROW_START), (Number(t.col || 1) + heroColStart), fallbackId);
      }

      const masteryId = Object.keys(talents).map(Number).find((id) => talents[id].mastery) ||
        (Object.keys(talents).length ? Number(Object.keys(talents)[0]) : 0);

      const mappedTabId = (CLASS_TAB_ORDER[classId] && CLASS_TAB_ORDER[classId][i]) || 0;
      const syntheticTabId = 10000 + (classId * 10) + tabIdx;

      tabs[tabIdx] = {
        name: spec.name || `Spec ${tabIdx}`,
        tabId: mappedTabId || syntheticTabId,
        masteryTalentId: masteryId,
        talents,
      };
    }

    classes[classId] = { className, tabs };
  }

  return { classes };
}

// ── Read talent config JSON ──────────────────────────────────────────
app.get('/api/talent-config', (req, res) => {
  try {
    if (!fs.existsSync(TALENT_CONFIG_PATH)) {
      return res.json({ classes: {} });
    }
    const data = JSON.parse(fs.readFileSync(TALENT_CONFIG_PATH, 'utf-8'));
    res.json(data);
  } catch (err) {
    console.error('Error reading talent config:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Write talent config JSON ─────────────────────────────────────────
app.post('/api/talent-config', (req, res) => {
  try {
    const data = req.body;
    fs.writeFileSync(TALENT_CONFIG_PATH, JSON.stringify(data, null, 2));
    console.log('Talent config saved to', TALENT_CONFIG_PATH);
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving talent config:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Import current DBC data into JSON (one-time migration) ───────────
app.post('/api/talent-config/import-dbc', (req, res) => {
  try {
    const config = loadConfigFile();
    const talentPath = resolveDbcPath(config, 'Talent.dbc');

    if (!fs.existsSync(talentPath)) {
      return res.status(404).json({ error: 'Talent.dbc not found for import' });
    }

    const talents = parseTalentDBC(talentPath);
    if (!talents || !talents.length) {
      return res.status(400).json({ error: 'No talents found in DBC' });
    }

    // Group by tab
    const byTab = {};
    for (const t of talents) {
      if (!byTab[t.tabId]) byTab[t.tabId] = [];
      byTab[t.tabId].push(t);
    }

    // Build JSON config in editor schema (classes -> specs + classTree)
    const classes = {};
    for (const [classIdStr, tabIds] of Object.entries(CLASS_TAB_ORDER)) {
      const classId = Number(classIdStr);
      const className = CLASS_ID_MAP[classId];
      const specs = [];

      for (let ti = 0; ti < tabIds.length; ti++) {
        const tabId = tabIds[ti];
        const tabTalents = byTab[tabId] || [];

        // Sort by row, col, id
        tabTalents.sort((a, b) => {
          if (a.row !== b.row) return a.row - b.row;
          if (a.column !== b.column) return a.column - b.column;
          return a.id - b.id;
        });

        // Find mastery (lowest ID)
        const masteryId = tabTalents.length > 0
          ? Math.min(...tabTalents.map(t => t.id))
          : 0;

        const classTreeTalents = [];
        const specTalents = [];
        const hero1Talents = [];
        const hero2Talents = [];

        const toEntry = (t, row1Based, col1Based, isMastery) => {
          const spells = Array.isArray(t.spellRanks) ? t.spellRanks.filter(s => s > 0) : [];
          const entry = {
            id: t.id,
            row: row1Based,
            col: col1Based,
            maxRank: spells.length,
            spells,
          };

          const prereqs = [];
          for (let p = 0; p < 3; p++) {
            if (t.prereqTalents[p] > 0) {
              prereqs.push({ id: t.prereqTalents[p], rank: t.prereqRanks[p] || 0 });
            }
          }
          if (prereqs.length > 0) entry.prereqs = prereqs;
          if (t.flags > 0) entry.flags = t.flags;
          if (isMastery) entry.mastery = true;
          return entry;
        };

        const specCols = SPEC_DEFAULT_COLS;
        const heroColStart = SPEC_COL_START + specCols;

        for (const t of tabTalents) {
          const globalRow = Number(t.row || 0) + 1;
          const globalCol = Number(t.column || 0) + 1;
          const isMastery = t.id === masteryId;

          // WoTLK tabs are spec-specific; avoid class-wide bucketization here.

          if (globalCol >= SPEC_COL_START + 1 && globalCol <= SPEC_COL_START + specCols) {
            specTalents.push(toEntry(t, globalRow, globalCol - SPEC_COL_START, isMastery));
            continue;
          }

          if (globalCol >= heroColStart + 1 && globalCol <= heroColStart + SIDE_TREE_COLS) {
            if (globalRow >= 1 && globalRow <= SIDE_TREE_ROWS) {
              hero1Talents.push(toEntry(t, globalRow, globalCol - heroColStart, isMastery));
              continue;
            }

            if (globalRow >= HERO2_ROW_START + 1 && globalRow <= HERO2_ROW_START + SIDE_TREE_ROWS) {
              hero2Talents.push(toEntry(t, globalRow - HERO2_ROW_START, globalCol - heroColStart, isMastery));
              continue;
            }
          }

          specTalents.push(toEntry(t, globalRow, Math.max(1, globalCol), isMastery));
        }

        specs.push({
          name: TAB_NAMES[tabId] || `Tab ${tabId}`,
          rows: SPEC_DEFAULT_ROWS,
          cols: SPEC_DEFAULT_COLS,
          talents: specTalents,
          heroTrees: [
            { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: hero1Talents },
            { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: hero2Talents },
          ],
        });

        if (classTreeTalents.length > 0) {
          const classTree = classes[classId]?.classTree || { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] };
          const existingIds = new Set((classTree.talents || []).map((t) => Number(t.id)));
          for (const t of classTreeTalents) {
            if (!existingIds.has(Number(t.id))) {
              classTree.talents.push(t);
              existingIds.add(Number(t.id));
            }
          }

          if (!classes[classId]) {
            classes[classId] = { className, classTree, specs: [] };
          } else {
            classes[classId].classTree = classTree;
          }
        }
      }

      if (!classes[classId]) {
        classes[classId] = {
          className,
          classTree: { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] },
          specs,
        };
      } else {
        classes[classId].specs = specs;
      }
    }

    const configData = { classes };
    fs.writeFileSync(TALENT_CONFIG_PATH, JSON.stringify(configData, null, 2));

    const totalTalents = talents.length;
    console.log(`Imported ${totalTalents} talents from DBC into ${TALENT_CONFIG_PATH}`);
    res.json({ success: true, imported: totalTalents });
  } catch (err) {
    console.error('Error importing DBC:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Generate Lua config from JSON → SurrealTalentConfig_AIO.lua ──────
app.post('/api/talent-config/deploy', (req, res) => {
  try {
    if (!fs.existsSync(TALENT_CONFIG_PATH)) {
      return res.status(404).json({ error: 'No talent config found. Import from DBC or create talents first.' });
    }

    const configData = JSON.parse(fs.readFileSync(TALENT_CONFIG_PATH, 'utf-8'));

    // Snapshot the exact config that's live right now — this is what Spec
    // Builder will read from this point on (see loadDeployedTalentConfig()),
    // so its layout freezes to this snapshot until the next deploy.
    fs.writeFileSync(TALENT_DEPLOYED_PATH, JSON.stringify(configData, null, 2));

    const normalized = normalizeTalentConfig(configData);
    const classes = normalized.classes || {};

    // Build Lua string
    let lua = '';
    lua += '-- ═══════════════════════════════════════════════════════════════════\n';
    lua += '-- SurrealTalentConfig_AIO.lua  —  Shared talent tree definitions\n';
    lua += '-- Auto-generated by SDB Editor  —  DO NOT EDIT MANUALLY\n';
    lua += '-- Used by both client (AIO addon) and server (Eluna validation)\n';
    lua += '-- ═══════════════════════════════════════════════════════════════════\n\n';
    lua += '-- Register with AIO so this file is sent to clients.\n';
    lua += '-- Do NOT wrap in if/else — SURREAL_TALENT_TREES must exist on BOTH sides.\n';
    lua += 'local AIO = AIO or require("AIO")\n';
    lua += 'AIO.AddAddon()\n\n';
    lua += 'SURREAL_TALENT_TREES = {\n';

    // Sort class IDs
    const sortedClassIds = Object.keys(classes).map(Number).sort((a, b) => a - b);

    for (const classId of sortedClassIds) {
      const cls = classes[classId];
      const className = cls.className || CLASS_ID_MAP[classId] || 'UNKNOWN';
      lua += `    -- ══ ${className} (classId=${classId}) ══\n`;
      lua += `    [${classId}] = {\n`;
      lua += `        className = "${className}",\n`;
      lua += `        tabs = {\n`;

      // Sort tab indices
      const sortedTabIdxs = Object.keys(cls.tabs).map(Number).sort((a, b) => a - b);

      for (const tabIdx of sortedTabIdxs) {
        const tab = cls.tabs[tabIdx];
        lua += `            [${tabIdx}] = {\n`;
        lua += `                name = "${tab.name || 'Unknown'}",\n`;
        lua += `                tabId = ${tab.tabId || 0},\n`;
        lua += `                masteryTalentId = ${tab.masteryTalentId || 0},\n`;
        lua += `                talents = {\n`;

        // Sort talents by row, col
        const talentIds = Object.keys(tab.talents).map(Number).sort((a, b) => {
          const ta = tab.talents[a], tb = tab.talents[b];
          if (ta.row !== tb.row) return ta.row - tb.row;
          return ta.col - tb.col;
        });

        for (const tid of talentIds) {
          const t = tab.talents[tid];
          let line = `                    [${tid}] = {row=${t.row}, col=${t.col}, maxRank=${t.maxRank}, spells={${(t.spells || []).join(', ')}}`;
          if (t.prereqs && t.prereqs.length > 0) {
            const pParts = t.prereqs.map(p => `{id=${p.id}, rank=${p.rank || 0}}`);
            line += `, prereqs={${pParts.join(', ')}}`;
          }
          if (t.flags && t.flags > 0) {
            line += `, flags=${t.flags}`;
          }
          if (t.mastery) {
            line += ', mastery=true';
          }
          line += '},';
          lua += line + '\n';
        }

        lua += `                },  -- talents\n`;
        lua += `            },  -- ${tab.name || 'Unknown'}\n`;
      }

      lua += `        },  -- tabs\n`;
      lua += `    },  -- ${className}\n\n`;
    }

    lua += '}  -- SURREAL_TALENT_TREES\n';

    // Write Lua file
    const luaPath = path.join(LUA_SCRIPTS_DIR, 'SurrealTalentConfig_AIO.lua');
    if (!fs.existsSync(LUA_SCRIPTS_DIR)) fs.mkdirSync(LUA_SCRIPTS_DIR, { recursive: true });
    fs.writeFileSync(luaPath, lua);

    const runtimeLuaPath = path.join(LUA_SCRIPTS_RUNTIME_DIR, 'SurrealTalentConfig_AIO.lua');
    if (fs.existsSync(path.dirname(LUA_SCRIPTS_RUNTIME_DIR)) || fs.existsSync(LUA_SCRIPTS_RUNTIME_DIR)) {
      fs.mkdirSync(LUA_SCRIPTS_RUNTIME_DIR, { recursive: true });
      fs.writeFileSync(runtimeLuaPath, lua);
    }

    // Write wipe file for server-side cleanup (clear talents per class)
    try {
      const classIds = sortedClassIds;
      const wipeBody = `return { classes = { ${classIds.join(', ')} } }\n`;
      fs.writeFileSync(TALENT_WIPE_PATH, wipeBody);

      const runtimeWipePath = path.join(LUA_SCRIPTS_RUNTIME_DIR, 'SurrealTalentWipe.lua');
      if (fs.existsSync(path.dirname(LUA_SCRIPTS_RUNTIME_DIR)) || fs.existsSync(LUA_SCRIPTS_RUNTIME_DIR)) {
        fs.mkdirSync(LUA_SCRIPTS_RUNTIME_DIR, { recursive: true });
        fs.writeFileSync(runtimeWipePath, wipeBody);
      }
    } catch (wipeErr) {
      console.warn('Failed to write talent wipe file:', wipeErr.message);
    }

    const classCount = sortedClassIds.length;
    let totalTalents = 0;
    for (const cid of sortedClassIds) {
      for (const t of Object.values(classes[cid].tabs)) {
        totalTalents += Object.keys(t.talents).length;
      }
    }

    console.log(`Deployed talent config: ${totalTalents} talents across ${classCount} classes → ${luaPath}`);
    res.json({
      success: true,
      luaPath,
      classes: classCount,
      talents: totalTalents,
      bytes: lua.length,
    });
  } catch (err) {
    console.error('Error deploying talent config:', err);
    res.status(500).json({ error: err.message });
  }
});

// Reverse map: tabId → { classToken, tabNumber(1-based) }
function buildTabMetadata() {
  const meta = {};  // tabId → { classToken, tabNumber }

  for (const [className, tabIds] of Object.entries(classToTabMapping)) {
    // Derive class token from className
    const token = className.replace('-', '').toUpperCase();  // 'death-knight' → 'DEATHKNIGHT'
    for (let i = 0; i < tabIds.length; i++) {
      meta[tabIds[i]] = { classToken: token, tabNumber: i + 1 };
    }
  }
  return meta;
}

app.post('/api/talents/repack-export', (req, res) => {
  // DISABLED — DBC repack is no longer used. The custom talent system uses
  // JSON → Lua deployment via /api/talent-config/deploy instead.
  // Repacking a modified Talent.dbc into the server data dir crashes the worldserver.
  return res.status(410).json({
    error: 'DBC repack is disabled. Use Deploy to Server (JSON → Lua) instead.',
    hint: 'The custom talent system no longer uses Talent.dbc.'
  });
  try {
    const config = loadConfigFile();
    const dbcDir = path.join(PUBLIC_DIR, getActiveDBCDir(config));
    const talentPath = path.join(dbcDir, 'Talent.dbc');

    if (!fs.existsSync(talentPath)) {
      return res.status(404).json({ error: 'Talent.dbc not found' });
    }

    // Read the DBC buffer
    const buffer = Buffer.from(fs.readFileSync(talentPath));
    const magic = buffer.toString('utf-8', 0, 4);
    if (magic !== 'WDBC') {
      return res.status(400).json({ error: 'Invalid Talent.dbc format' });
    }

    const recordCount = buffer.readUInt32LE(4);
    const recordSize = buffer.readUInt32LE(12);
    const headerSize = 20;

    // Parse all talents (keeping their buffer offsets)
    const talents = [];
    for (let i = 0; i < recordCount; i++) {
      const offset = headerSize + i * recordSize;
      talents.push({
        offset,
        id: buffer.readUInt32LE(offset),
        tabId: buffer.readUInt32LE(offset + 4),
        row: buffer.readUInt32LE(offset + 8),    // current display row
        col: buffer.readUInt32LE(offset + 12),   // current display col
      });
    }

    // Group by tab
    const byTab = {};
    for (const t of talents) {
      if (!byTab[t.tabId]) byTab[t.tabId] = [];
      byTab[t.tabId].push(t);
    }

    // Build tab metadata (tabId → classToken + tabNumber)
    const tabMeta = buildTabMetadata();

    // For each tab: sort by (row, col), find mastery (lowest ID), 
    // assign packed DBC coords, build Lua coordinate table
    const luaCoords = {};  // classToken → { tabNumber → { index → [row1, col1] } }
    const MAX_DBC_COLS = 4; // cols 0-3

    for (const [tabIdStr, tabTalents] of Object.entries(byTab)) {
      const tabId = Number(tabIdStr);
      const meta = tabMeta[tabId];
      if (!meta) continue; // skip pet talent tabs etc.

      // Sort by (row, col) — this is the DISPLAY order
      tabTalents.sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);

      // Find mastery (lowest talent ID) and ensure it's first
      let masteryIdx = 0;
      for (let i = 1; i < tabTalents.length; i++) {
        if (tabTalents[i].id < tabTalents[masteryIdx].id) masteryIdx = i;
      }
      if (masteryIdx !== 0) {
        const mastery = tabTalents.splice(masteryIdx, 1)[0];
        tabTalents.unshift(mastery);
      }

      // Assign packed DBC coords (row 0 cols 0-3, row 1 cols 0-3, ...)
      // and build Lua coordinate table
      if (!luaCoords[meta.classToken]) luaCoords[meta.classToken] = {};
      luaCoords[meta.classToken][meta.tabNumber] = {};

      for (let i = 0; i < tabTalents.length; i++) {
        const t = tabTalents[i];
        const packedRow = Math.floor(i / MAX_DBC_COLS);
        const packedCol = i % MAX_DBC_COLS;

        // Write packed coords into DBC buffer
        buffer.writeUInt32LE(packedRow, t.offset + 8);
        buffer.writeUInt32LE(packedCol, t.offset + 12);

        // Store display coords in Lua table (1-based for TalentPos)
        const talentIndex = i + 1; // 1-based index matching GetTalentInfo(tab, idx)
        luaCoords[meta.classToken][meta.tabNumber][talentIndex] = [
          t.row + 1,  // display row (1-based)
          t.col + 1,  // display col (1-based)
        ];
      }
    }

    // Backup before writing
    const backupPath = talentPath + '.repack.bak';
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(talentPath, backupPath);
    }

    // Write repacked DBC to DEPLOYMENT locations only.
    // Do NOT overwrite public/dbc — keep synced base intact.
    const destinations = [];

    const exportDir = path.join(EXPORT_DIR, 'DBFilesClient');
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
    const exportPath = path.join(exportDir, 'Talent.dbc');
    destinations.push(exportPath);

    // Server data/dbc — what the worldserver loads
    const serverDbcPath = path.join(SERVER_DBC_DIR, 'Talent.dbc');
    destinations.push(serverDbcPath);

    for (const dest of destinations) {
      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dest, buffer);
    }

    // Generate Lua coordinate file with AIO header so it gets sent to client
    let lua = '-- Auto-generated by SDB Editor — DO NOT EDIT MANUALLY\n';
    lua += '-- Maps class → tab → talent index → {display_row, display_col} (1-based)\n';
    lua += '-- The 3.3.5a client has a hardcoded col limit (0-3), so the DBC uses\n';
    lua += '-- packed coordinates while this table provides the real display positions.\n\n';
    lua += 'local AIO = AIO or require("AIO")\n';
    lua += 'if AIO.AddAddon() then\n\n';
    lua += 'SURREAL_TALENT_COORDS = {\n';

    for (const [classToken, tabs] of Object.entries(luaCoords)) {
      lua += `    ${classToken} = {\n`;
      for (const [tabNum, indices] of Object.entries(tabs)) {
        lua += `        [${tabNum}] = {\n`;
        const sortedIndices = Object.keys(indices).map(Number).sort((a, b) => a - b);
        for (const idx of sortedIndices) {
          const [r, c] = indices[idx];
          lua += `            [${idx}] = {${r}, ${c}},\n`;
        }
        lua += '        },\n';
      }
      lua += '    },\n';
    }
    lua += '}\n\n';
    lua += 'end -- AIO.AddAddon()\n';

    // Write Lua file
    const luaPath = path.join(LUA_SCRIPTS_DIR, 'SurrealTalentCoords_AIO.lua');
    if (!fs.existsSync(LUA_SCRIPTS_DIR)) fs.mkdirSync(LUA_SCRIPTS_DIR, { recursive: true });
    fs.writeFileSync(luaPath, lua);

    // Invalidate DBC cache
    dbcCache.talents = null;
    if (dbcCache.lastModified) dbcCache.lastModified.talentDbc = 0;

    console.log(`Repack complete: ${recordCount} talents repacked, Lua coords written to ${luaPath}`);
    console.log(`DBC written to: ${destinations.join(', ')}`);

    res.json({
      success: true,
      repacked: recordCount,
      destinations,
      luaPath,
      classesProcessed: Object.keys(luaCoords),
    });
  } catch (error) {
    console.error('Error repacking talents:', error);
    logErrorToFile(`Error repacking talents: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Regenerate sprite sheets on demand
app.post('/api/sprites/regenerate', async (req, res) => {
  try {
    console.log('Regenerating sprite sheets on demand...');
    const result = await generateSpriteSheets();
    
    // Invalidate cache
    dbcCache.talents = null;
    if (dbcCache.lastModified) dbcCache.lastModified.talentDbc = 0;

    res.json({ 
      success: true, 
      sheets: result.sheets,
      message: `Regenerated ${result.sheets} sprite sheets` 
    });
  } catch (error) {
    console.error('Error regenerating sprites:', error);
    res.status(500).json({ error: error.message });
  }
});

// Spell name search (q=...&limit=...)
app.get('/api/spell-search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
    if (!q || q.length < 2) return res.json({ results: [] });

    const results = await getSpellSearchEntriesFromSql(q, limit);
    return res.json({ results });
  } catch (error) {
    console.error('Error searching spells from SQL:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Paginated, ID-ordered full spell list for the Spell Editor's left-hand
// browser panel — unlike /api/spell-search (name/id search only, no icons,
// requires 2+ chars), this always returns a page of spells in ascending ID
// order (optionally filtered) with icon names resolved from the spell-icon
// index so thumbnails render in the list.
app.get('/api/spell-list', async (req, res) => {
  try {
    const schema = await loadCustomSpellSchema();
    if (!schema) return res.status(503).json({ error: 'Custom spell database unavailable' });

    const nameColumn =
      schema.normalizedToActual.spellname0 ||
      schema.normalizedToActual.spellname ||
      schema.normalizedToActual.name ||
      null;

    const q = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const selectName = nameColumn ? `\`${nameColumn}\` AS SpellName` : `NULL AS SpellName`;
    let whereClause = '';
    let params = [];
    if (q) {
      if (nameColumn) {
        whereClause = `WHERE CAST(\`ID\` AS CHAR) LIKE ? OR \`${nameColumn}\` LIKE ?`;
        params = [`%${q}%`, `%${q}%`];
      } else {
        whereClause = `WHERE CAST(\`ID\` AS CHAR) LIKE ?`;
        params = [`%${q}%`];
      }
    }

    const { rows, total } = await withCustomSpellConnection(async (conn) => {
      const [countRows] = await conn.query(
        `SELECT COUNT(*) AS total FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` ${whereClause}`,
        params
      );
      const total = Number(countRows?.[0]?.total || 0);

      const [rows] = await conn.query(
        `SELECT \`ID\`, ${selectName} FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` ${whereClause} ORDER BY \`ID\` ASC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      return { rows: rows || [], total };
    });

    if (!dbcCache.spellIconIndex) {
      try { loadOrBuildSpellIconIndex(); } catch (e) { /* ignore */ }
    }
    const spellIconIndex = dbcCache.spellIconIndex || {};

    const spells = rows.map((row) => {
      const id = Number(row.ID || 0);
      const name = String(row.SpellName || `Spell ${id}`).trim() || `Spell ${id}`;
      const icon = spellIconIndex[id] ?? spellIconIndex[String(id)] ?? null;
      return { id, name, icon };
    });

    res.json({ total, offset, limit, spells });
  } catch (error) {
    console.error('Error listing spells from SQL:', error);
    res.status(500).json({ error: error.message });
  }
});

// Given a spell ID (and optional q filter matching /api/spell-list's WHERE
// clause), return that spell's zero-based position in the ID-ascending list.
// Lets the Spell Editor's infinite-scroll list jump straight to a looked-up
// spell's location (e.g. the custom 900000+ range) without paging through
// everything before it.
app.get('/api/spell-list-offset', async (req, res) => {
  try {
    const schema = await loadCustomSpellSchema();
    if (!schema) return res.status(503).json({ error: 'Custom spell database unavailable' });

    const nameColumn =
      schema.normalizedToActual.spellname0 ||
      schema.normalizedToActual.spellname ||
      schema.normalizedToActual.name ||
      null;

    const id = Number(req.query.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id is required' });

    const q = String(req.query.q || '').trim();
    let whereParts = [`\`ID\` < ?`];
    let params = [id];
    if (q) {
      if (nameColumn) {
        whereParts.push(`(CAST(\`ID\` AS CHAR) LIKE ? OR \`${nameColumn}\` LIKE ?)`);
        params.push(`%${q}%`, `%${q}%`);
      } else {
        whereParts.push(`CAST(\`ID\` AS CHAR) LIKE ?`);
        params.push(`%${q}%`);
      }
    }
    const whereClause = `WHERE ${whereParts.join(' AND ')}`;

    const existsWhereParts = [`\`ID\` = ?`];
    const existsParams = [id];
    if (q) {
      if (nameColumn) {
        existsWhereParts.push(`(CAST(\`ID\` AS CHAR) LIKE ? OR \`${nameColumn}\` LIKE ?)`);
        existsParams.push(`%${q}%`, `%${q}%`);
      } else {
        existsWhereParts.push(`CAST(\`ID\` AS CHAR) LIKE ?`);
        existsParams.push(`%${q}%`);
      }
    }

    const { offset, exists } = await withCustomSpellConnection(async (conn) => {
      const [existsRows] = await conn.query(
        `SELECT COUNT(*) AS c FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` WHERE ${existsWhereParts.join(' AND ')}`,
        existsParams
      );
      const exists = Number(existsRows?.[0]?.c || 0) > 0;

      const [offsetRows] = await conn.query(
        `SELECT COUNT(*) AS offset FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` ${whereClause}`,
        params
      );
      const offset = Number(offsetRows?.[0]?.offset || 0);
      return { offset, exists };
    });

    if (!exists) return res.status(404).json({ error: `Spell ${id} not found` });
    res.json({ id, offset });
  } catch (error) {
    console.error('Error resolving spell list offset:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/spell-enums', (req, res) => {
  try {
    const payload = getSpellEnumPayload();
    res.json(payload);
  } catch (error) {
    console.error('Error building spell enum payload:', error);
    logErrorToFile(`Error building spell enum payload: ${error.stack || error}`);
    res.status(500).json({ error: 'Failed to load spell enums' });
  }
});

// Get spell-icon index stats
app.get('/api/spell-icon-index', (req, res) => {
  if (!dbcCache.spellIconIndex) {
    try { loadOrBuildSpellIconIndex(); } catch (e) {
      console.error('⚠ Spell-icon index build failed (non-fatal):', e.message);
    }
  }
  const index = dbcCache.spellIconIndex;
  if (!index) return res.status(404).json({ error: 'Index not available' });

  // Return stats + optionally full index if ?full=true
  const full = req.query.full === 'true';
  const stats = { entries: Object.keys(index).length };
  if (fs.existsSync(SPELL_ICON_INDEX_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(SPELL_ICON_INDEX_PATH, 'utf8'));
      stats.meta = data.meta;
    } catch (e) { /* ignore */ }
  }
  res.json(full ? { ...stats, index } : stats);
});

// Get icon manifest
app.get('/api/icon-manifest', (req, res) => {
  try {
    const manifestPath = path.join(PUBLIC_DIR, 'icon-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return res.json({ 
        generated: new Date().toISOString(),
        count: 0,
        icons: [],
        message: 'Manifest not yet generated. Upload an icon or call /api/update-manifest'
      });
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    res.json(manifest);
  } catch (err) {
    console.error('Failed to read manifest:', err);
    res.status(500).json({ error: 'Failed to read manifest' });
  }
});

// Endpoint to get spell icon mappings
app.get('/api/spell-icons', (req, res) => {
  try {
    const config = loadConfigFile();
    const spellIconPath = resolveDbcPath(config, 'SpellIcon.dbc');
    
    if (!fs.existsSync(spellIconPath)) {
      return res.status(404).json({ error: 'SpellIcon.dbc not found' });
    }

    const buffer = fs.readFileSync(spellIconPath);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // Read DBC header
    const magic = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3]);
    if (magic !== 'WDBC') {
      return res.status(400).json({ error: 'Invalid DBC file format' });
    }

    const recordCount = view.getUint32(4, true);
    const fieldCount = view.getUint32(8, true);
    const recordSize = view.getUint32(12, true);
    const stringBlockSize = view.getUint32(16, true);

    const headerSize = 20;
    const stringBlockOffset = headerSize + (recordCount * recordSize);

    // Read string from string block
    const readString = (offset) => {
      if (offset === 0) return '';
      const start = stringBlockOffset + offset;
      let end = start;
      while (end < buffer.length && buffer[end] !== 0) end++;
      return buffer.slice(start, end).toString('utf8');
    };

    const icons = [];
    for (let i = 0; i < recordCount; i++) {
      const recordOffset = headerSize + (i * recordSize);
      const id = view.getUint32(recordOffset, true);
      const iconPathOffset = view.getUint32(recordOffset + 4, true);
      const iconPath = readString(iconPathOffset);
      
      icons.push({ id, iconPath });
    }

    res.json({ icons });
  } catch (error) {
    console.error('Error reading SpellIcon.dbc:', error);
    logErrorToFile(`Error reading SpellIcon.dbc: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/spell-ref-options', async (req, res) => {
  try {
    const field = String(req.query.field || '').trim();
    if (!SPELL_REF_FIELD_CONFIG[field]) {
      return res.status(400).json({ error: 'Unsupported field' });
    }

    const query = String(req.query.q || '');
    const limit = toSafeReferenceLimit(req.query.limit, 40);
    const options = await querySpellReferenceOptions(field, query, limit);
    return res.json({ field, options, source: CUSTOM_SPELL_DB });
  } catch (error) {
    console.error('Error loading spell reference options:', error);
    return res.status(500).json({ error: error.message });
  }
});


// Endpoint to get spell data (maps spellId to spellIconId)
app.get('/api/spells/:spellId(\\d+)', async (req, res) => {
  try {
    const spellId = parseInt(req.params.spellId);
    if (!Number.isFinite(spellId) || spellId <= 0) {
      return res.status(400).json({ error: 'Invalid spell ID' });
    }

    const details = await buildSqlOnlySpellDetails(spellId);
    if (!details) {
      return res.status(404).json({ error: 'Spell not found' });
    }

    return res.json(details);
  } catch (error) {
    console.error('Error reading spell from SQL:', error);
    logErrorToFile(`Error reading spell from SQL: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Export Spell.dbc - download effective editable copy
app.get('/api/spells/export', (req, res) => {
  try {
    const config = loadConfigFile();
    const spellPath = getSpellEditableDbcPath(config);

    if (!fs.existsSync(spellPath)) {
      return res.status(404).json({ error: 'Spell.dbc not found' });
    }

    res.download(spellPath, 'Spell.dbc');
  } catch (error) {
    console.error('Error exporting Spell.dbc:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── SQL -> DBC export pipeline for the visual/missile companion DBCs ─────
// These 8 tables are the "everything else" Stoneharry's tool regenerates
// alongside Spell.dbc on export. Unlike Spell.dbc (234 fields, only
// partially named - a full readDBC/writeDBC round trip is unsafe per the
// modify-client-spell-visuals skill), these are simple, fully-numeric (or
// tiny-string) schemas that are safe to fully regenerate from SQL.
const VISUAL_CHAIN_DBC_TABLES = [
  { dbc: 'SpellVisual', table: 'spellvisual' },
  { dbc: 'SpellVisualKit', table: 'spellvisualkit' },
  { dbc: 'SpellVisualEffectName', table: 'spellvisualeffectname' },
  { dbc: 'SpellMissile', table: 'spellmissile' },
  { dbc: 'SpellMissileMotion', table: 'spellmissilemotion' },
  { dbc: 'SpellVisualKitAreaModel', table: 'spellvisualkitareamodel' },
  { dbc: 'SpellVisualKitModelAttach', table: 'spellvisualkitmodelattach' },
  { dbc: 'SpellVisualPrecastTransitions', table: 'spellvisualprecasttransitions' },
];

// Normalize a SQL numeric value into the signed 32-bit range expected by
// writeDBC()'s 'int32' writer. sdbeditor stores several int32 DBC fields in
// UNSIGNED SQL columns, so a "-1" sentinel shows up as 4294967295 - passing
// that straight to Buffer.writeInt32LE throws a RangeError. This handles
// both representations (already-signed OR unsigned-wrapped) safely.
function toSigned32(value) {
  let n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return 0;
  n = ((n % 4294967296) + 4294967296) % 4294967296; // normalize into [0, 2^32)
  if (n > 2147483647) n -= 4294967296;
  return n;
}

function backupDbcOnce(filePath, tag) {
  const backupPath = `${filePath}.bak-${tag}`;
  if (fs.existsSync(filePath) && !fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath);
  }
}

// Regenerate one visual/missile DBC file directly from its sdbeditor SQL
// table, writing to the live server data/dbc/ path AND the client export
// staging folder (export/DBFilesClient/), per this fork's established
// "edit -> data/dbc + DBFilesClient" workflow.
async function exportOneVisualChainDbc({ dbc, table }) {
  const def = DBC_DEFINITIONS[dbc];
  if (!def) throw new Error(`No dbc-definitions.js schema for ${dbc}`);
  const fieldDefs = def.fields;
  const cols = fieldDefs.map((f) => f.name);

  const rows = await withCustomSpellConnection(async (conn) => {
    const [result] = await conn.query(
      `SELECT ${cols.map((c) => `\`${c}\``).join(', ')} FROM \`${CUSTOM_SPELL_DB}\`.\`${table}\` ORDER BY \`ID\` ASC`
    );
    return result;
  });
  if (!rows) throw new Error(`Could not query ${CUSTOM_SPELL_DB}.${table} (DB connection unavailable)`);

  const records = rows.map((row) => fieldDefs.map((f) => {
    const raw = row[f.name];
    switch (f.type) {
      case 'float': return Number(raw) || 0;
      case 'int32': return toSigned32(raw);
      case 'string': return raw == null ? '' : String(raw);
      default: return Math.trunc(Number(raw)) >>> 0; // uint32 / flags
    }
  }));

  const liveDbcPath = path.join(SERVER_DBC_DIR, `${dbc}.dbc`);
  backupDbcOnce(liveDbcPath, 'pre-sql-export');
  writeDBC(liveDbcPath, { fieldDefs, records });

  const exportDbcDir = path.join(EXPORT_DIR, 'DBFilesClient');
  if (!fs.existsSync(exportDbcDir)) fs.mkdirSync(exportDbcDir, { recursive: true });
  fs.copyFileSync(liveDbcPath, path.join(exportDbcDir, `${dbc}.dbc`));

  return { dbc, table, recordCount: records.length };
}

async function exportAllVisualChainDbcs() {
  const results = [];
  for (const entry of VISUAL_CHAIN_DBC_TABLES) {
    results.push(await exportOneVisualChainDbc(entry));
  }
  return results;
}

// Regenerate ALL 8 visual/missile companion DBCs from sdbeditor SQL, then
// write both to data/dbc/ (live server path) and export/DBFilesClient/
// (client staging path). This is the "export spells also exports the
// visual chain" step matching Stoneharry's tool.
app.post('/api/spells/export-visual-dbcs', async (req, res) => {
  try {
    const results = await exportAllVisualChainDbcs();
    res.json({ success: true, exported: results });
  } catch (error) {
    console.error('Error exporting visual/missile DBCs:', error);
    logErrorToFile(`Error exporting visual/missile DBCs: ${error.stack || error}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Visual-chain aggregation + clone-safe editing ─────────────────────────
// Backs the SpellEditor "Visual" tab's 5 sub-tabs (Base / Missile Model /
// Kits and Effects / Motion / Map Builder). Resolves the full
// Spell -> SpellVisual -> SpellVisualKit -> SpellVisualEffectName (+
// SpellMissile / SpellMissileMotion / SpellVisualKitModelAttach) chain for
// one spell in a single request.
const VISUAL_KIT_FIELD_NAMES = ['PrecastKit', 'CastKit', 'ImpactKit', 'StateKit', 'StateDoneKit', 'ChannelKit', 'CasterImpactKit', 'TargetImpactKit'];
const KIT_EFFECT_FIELD_NAMES = ['HeadEffect', 'ChestEffect', 'BaseEffect', 'LeftHandEffect', 'RightHandEffect', 'BreathEffect', 'LeftWeaponEffect', 'RightWeaponEffect', 'SpecialEffect1', 'SpecialEffect2', 'SpecialEffect3', 'WorldEffect'];

app.get('/api/spells/:spellId(\\d+)/visual-chain', async (req, res) => {
  try {
    const spellId = parseInt(req.params.spellId, 10);
    if (!Number.isFinite(spellId) || spellId <= 0) {
      return res.status(400).json({ error: 'Invalid spell ID' });
    }

    const bundle = await withCustomSpellConnection(async (conn) => {
      const [[spellRow]] = await conn.query(
        `SELECT ID, SpellVisual1, SpellVisual2, SpellMissileID FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` WHERE ID=? LIMIT 1`,
        [spellId]
      );
      if (!spellRow) return null;

      const visual1Id = Number(spellRow.SpellVisual1 || 0);
      const missileId = Number(spellRow.SpellMissileID || 0);

      let visual = null;
      const kits = {};
      const effects = {};
      const modelAttach = {};
      let missileMotion = null;

      if (visual1Id > 0) {
        const [[visualRow]] = await conn.query(
          `SELECT * FROM \`${CUSTOM_SPELL_DB}\`.\`spellvisual\` WHERE ID=? LIMIT 1`,
          [visual1Id]
        );
        if (visualRow) {
          const [[cnt]] = await conn.query(
            `SELECT COUNT(*) AS c FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` WHERE SpellVisual1=? OR SpellVisual2=?`,
            [visual1Id, visual1Id]
          );
          visual = { id: visual1Id, row: visualRow, sharedCount: Number(cnt.c || 0) };

          const kitIds = [...new Set(VISUAL_KIT_FIELD_NAMES.map((f) => Number(visualRow[f] || 0)).filter((v) => v > 0))];
          if (kitIds.length) {
            const [kitRows] = await conn.query(
              `SELECT * FROM \`${CUSTOM_SPELL_DB}\`.\`spellvisualkit\` WHERE ID IN (${kitIds.map(() => '?').join(',')})`,
              kitIds
            );
            for (const kitRow of kitRows || []) {
              const kitId = Number(kitRow.ID);
              const [[kcnt]] = await conn.query(
                `SELECT COUNT(*) AS c FROM \`${CUSTOM_SPELL_DB}\`.\`spellvisual\` WHERE ${VISUAL_KIT_FIELD_NAMES.map((f) => `\`${f}\`=?`).join(' OR ')}`,
                VISUAL_KIT_FIELD_NAMES.map(() => kitId)
              );
              kits[kitId] = { id: kitId, row: kitRow, sharedCount: Number(kcnt.c || 0) };
            }

            const [attachRows] = await conn.query(
              `SELECT * FROM \`${CUSTOM_SPELL_DB}\`.\`spellvisualkitmodelattach\` WHERE ParentSpellVisualKitId IN (${kitIds.map(() => '?').join(',')}) ORDER BY ID ASC`,
              kitIds
            );
            for (const attachRow of attachRows || []) {
              const pid = Number(attachRow.ParentSpellVisualKitId);
              if (!modelAttach[pid]) modelAttach[pid] = [];
              modelAttach[pid].push(attachRow);
            }
          }

          // Collect effect ids referenced by every fetched kit, plus the
          // visual's own missile model effect.
          const effectIdSet = new Set();
          for (const kitId of Object.keys(kits)) {
            const kitRow = kits[kitId].row;
            for (const f of KIT_EFFECT_FIELD_NAMES) {
              const v = Number(kitRow[f] || 0);
              if (v > 0) effectIdSet.add(v);
            }
          }
          const missileModelId = Number(visualRow.MissileModel || 0);
          if (missileModelId > 0) effectIdSet.add(missileModelId);

          if (effectIdSet.size) {
            const effectIds = [...effectIdSet];
            const [effectRows] = await conn.query(
              `SELECT * FROM \`${CUSTOM_SPELL_DB}\`.\`spellvisualeffectname\` WHERE ID IN (${effectIds.map(() => '?').join(',')})`,
              effectIds
            );
            for (const effectRow of effectRows || []) {
              effects[Number(effectRow.ID)] = effectRow;
            }
          }

          const motionId = Number(visualRow.MissileMotion || 0);
          if (motionId > 0) {
            const [[motionRow]] = await conn.query(
              `SELECT * FROM \`${CUSTOM_SPELL_DB}\`.\`spellmissilemotion\` WHERE ID=? LIMIT 1`,
              [motionId]
            );
            if (motionRow) {
              const [[mcnt]] = await conn.query(
                `SELECT COUNT(*) AS c FROM \`${CUSTOM_SPELL_DB}\`.\`spellvisual\` WHERE MissileMotion=?`,
                [motionId]
              );
              missileMotion = { id: motionId, row: motionRow, sharedCount: Number(mcnt.c || 0) };
            }
          }
        }
      }

      let missile = null;
      if (missileId > 0) {
        const [[missileRow]] = await conn.query(
          `SELECT * FROM \`${CUSTOM_SPELL_DB}\`.\`spellmissile\` WHERE ID=? LIMIT 1`,
          [missileId]
        );
        if (missileRow) {
          const [[mcnt]] = await conn.query(
            `SELECT COUNT(*) AS c FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` WHERE SpellMissileID=?`,
            [missileId]
          );
          missile = { id: missileId, row: missileRow, sharedCount: Number(mcnt.c || 0) };
        }
      }

      const [areaModelRows] = await conn.query(
        `SELECT * FROM \`${CUSTOM_SPELL_DB}\`.\`spellvisualkitareamodel\` ORDER BY ID ASC`
      );

      return {
        spellId,
        spellVisual1: visual1Id,
        spellVisual2: Number(spellRow.SpellVisual2 || 0),
        spellMissileId: missileId,
        visual,
        kits,
        effects,
        modelAttach,
        missile,
        missileMotion,
        areaModels: areaModelRows || [],
      };
    });

    if (!bundle) return res.status(404).json({ error: 'Spell not found' });
    res.json(bundle);
  } catch (error) {
    console.error('Error building visual chain:', error);
    logErrorToFile(`Error building visual chain: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Reference-count lookups, keyed by table, used by the clone-safe editor
// below to decide whether an edit can happen in place or must clone first.
const CHAIN_REF_COUNT_QUERIES = {
  spellvisual: (id) => ({
    sql: `SELECT COUNT(*) AS c FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` WHERE SpellVisual1=? OR SpellVisual2=?`,
    params: [id, id],
  }),
  spellvisualkit: (id) => ({
    sql: `SELECT COUNT(*) AS c FROM \`${CUSTOM_SPELL_DB}\`.\`spellvisual\` WHERE ${VISUAL_KIT_FIELD_NAMES.map((f) => `\`${f}\`=?`).join(' OR ')}`,
    params: VISUAL_KIT_FIELD_NAMES.map(() => id),
  }),
  spellvisualeffectname: (id) => ({
    sql: `SELECT (
        (SELECT COUNT(*) FROM \`${CUSTOM_SPELL_DB}\`.\`spellvisualkit\` WHERE ${KIT_EFFECT_FIELD_NAMES.map((f) => `\`${f}\`=?`).join(' OR ')})
        +
        (SELECT COUNT(*) FROM \`${CUSTOM_SPELL_DB}\`.\`spellvisual\` WHERE MissileModel=?)
      ) AS c`,
    params: [...KIT_EFFECT_FIELD_NAMES.map(() => id), id],
  }),
  spellmissile: (id) => ({
    sql: `SELECT COUNT(*) AS c FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` WHERE SpellMissileID=?`,
    params: [id],
  }),
  spellmissilemotion: (id) => ({
    sql: `SELECT COUNT(*) AS c FROM \`${CUSTOM_SPELL_DB}\`.\`spellvisual\` WHERE MissileMotion=?`,
    params: [id],
  }),
};

async function countChainReferences(table, id) {
  const builder = CHAIN_REF_COUNT_QUERIES[table];
  if (!builder) return 0;
  const { sql, params } = builder(id);
  const row = await withCustomSpellConnection(async (conn) => {
    const [[r]] = await conn.query(sql, params);
    return r;
  });
  return Number(row?.c || 0);
}

const CHAIN_EDITABLE_TABLES = new Set(['spellvisual', 'spellvisualkit', 'spellvisualeffectname', 'spellmissile', 'spellmissilemotion']);

// Generic clone-safe editor for the 5 "chain" tables that real Blizzard
// content commonly shares across many spells. Per the
// modify-client-spell-visuals skill's CRITICAL SAFETY RULE: if the target
// row is referenced by more than this one spell, it is cloned into a new
// custom (900000+) ID instead of being edited in place, and the caller's
// `ownerRepoint` is updated to point at the clone.
app.put('/api/visual-chain/edit', async (req, res) => {
  try {
    const { table, id, fields, ownerRepoint } = req.body || {};
    if (!CHAIN_EDITABLE_TABLES.has(table)) {
      return res.status(400).json({ error: `Unsupported table: ${table}` });
    }
    const rowId = Number(id);
    if (!Number.isFinite(rowId) || rowId <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    if (!fields || typeof fields !== 'object' || !Object.keys(fields).length) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    if (ownerRepoint && (!ownerRepoint.table || !Number.isFinite(Number(ownerRepoint.id)) || !ownerRepoint.column)) {
      return res.status(400).json({ error: 'Invalid ownerRepoint' });
    }

    const sharedCountBefore = await countChainReferences(table, rowId);
    const needsClone = sharedCountBefore > 1;

    const outcome = await withCustomSpellConnection(async (conn) => {
      let finalId = rowId;
      let cloned = false;

      if (needsClone) {
        const [[existing]] = await conn.query(`SELECT * FROM \`${CUSTOM_SPELL_DB}\`.\`${table}\` WHERE ID=? LIMIT 1`, [rowId]);
        if (!existing) throw new Error(`${table} row ${rowId} not found`);

        const [[maxRow]] = await conn.query(
          `SELECT COALESCE(MAX(ID),899999) AS maxId FROM \`${CUSTOM_SPELL_DB}\`.\`${table}\` WHERE ID >= 900000`
        );
        finalId = Math.max(900000, Number(maxRow.maxId) + 1);

        const newRow = { ...existing, ...fields, ID: finalId };
        const columns = Object.keys(newRow);
        await conn.query(
          `INSERT INTO \`${CUSTOM_SPELL_DB}\`.\`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
          columns.map((c) => newRow[c])
        );
        cloned = true;

        // Cloning a shared kit must also clone the model-attach rows it
        // owns, repointed at the clone - otherwise the clone would keep
        // referencing (and risk corrupting) the original kit's attachments.
        if (table === 'spellvisualkit') {
          const [attachRows] = await conn.query(
            `SELECT * FROM \`${CUSTOM_SPELL_DB}\`.\`spellvisualkitmodelattach\` WHERE ParentSpellVisualKitId=?`,
            [rowId]
          );
          for (const attachRow of attachRows || []) {
            const [[attachMax]] = await conn.query(
              `SELECT COALESCE(MAX(ID),0) AS maxId FROM \`${CUSTOM_SPELL_DB}\`.\`spellvisualkitmodelattach\``
            );
            const newAttachRow = { ...attachRow, ID: Number(attachMax.maxId) + 1, ParentSpellVisualKitId: finalId };
            const acols = Object.keys(newAttachRow);
            await conn.query(
              `INSERT INTO \`${CUSTOM_SPELL_DB}\`.\`spellvisualkitmodelattach\` (${acols.map((c) => `\`${c}\``).join(', ')}) VALUES (${acols.map(() => '?').join(', ')})`,
              acols.map((c) => newAttachRow[c])
            );
          }
        }
      } else {
        const setSql = Object.keys(fields).map((c) => `\`${c}\` = ?`).join(', ');
        await conn.query(
          `UPDATE \`${CUSTOM_SPELL_DB}\`.\`${table}\` SET ${setSql} WHERE \`ID\` = ?`,
          [...Object.values(fields), rowId]
        );
      }

      if (cloned && ownerRepoint) {
        await conn.query(
          `UPDATE \`${CUSTOM_SPELL_DB}\`.\`${ownerRepoint.table}\` SET \`${ownerRepoint.column}\` = ? WHERE \`ID\` = ?`,
          [finalId, Number(ownerRepoint.id)]
        );
      }

      return { finalId, cloned };
    });

    res.json({ success: true, table, requestedId: rowId, sharedCountBefore, ...outcome });
  } catch (error) {
    console.error('Error editing visual-chain row:', error);
    logErrorToFile(`Error editing visual-chain row: ${error.stack || error}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/spells/:spellId/edit', async (req, res) => {
  try {
    const spellId = parseInt(req.params.spellId, 10);
    if (!Number.isFinite(spellId) || spellId <= 0) {
      return res.status(400).json({ error: 'Invalid spell ID' });
    }

    const fields = req.body?.fields;
    if (!fields || typeof fields !== 'object') {
      return res.status(400).json({ error: 'Missing fields payload' });
    }

    const existingRow = await getCustomSpellRow(spellId);
    if (!existingRow) return res.status(404).json({ error: 'Spell not found' });

    const normalizedFields = normalizeSpellPatchFields(fields);
    const mirrorResult = await mirrorSpellToCustomTable(spellId, normalizedFields)
      .catch(() => ({ mirrored: false, reason: 'mirror-failed' }));

    if (!mirrorResult?.mirrored || !Array.isArray(mirrorResult.columns) || !mirrorResult.columns.length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    let dbcPatch;
    try {
      dbcPatch = patchSpellDbcFromSql(spellId, normalizedFields);
    } catch (err) {
      dbcPatch = { patched: false, reason: `patch-threw: ${err.message}` };
    }

    const details = await buildSqlOnlySpellDetails(spellId);

    return res.json({
      success: true,
      spellId,
      updatedFields: mirrorResult.columns,
      skipped: [],
      mirror: mirrorResult,
      dbcPatch,
      details,
    });
  } catch (error) {
    console.error('Error updating spell SQL record:', error);
    logErrorToFile(`Error updating spell SQL record: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/spells/create-from-template', async (req, res) => {
  try {
    const templateSpellId = Number(req.body?.templateSpellId);
    const newSpellId = Number(req.body?.newSpellId);
    const fields = req.body?.fields;

    if (!Number.isFinite(templateSpellId) || templateSpellId <= 0) {
      return res.status(400).json({ error: 'Invalid template spell ID' });
    }
    if (!Number.isFinite(newSpellId) || newSpellId <= 0) {
      return res.status(400).json({ error: 'Invalid new spell ID' });
    }
    if (templateSpellId === newSpellId) {
      return res.status(400).json({ error: 'New spell ID must differ from template spell ID' });
    }

    const schema = await loadCustomSpellSchema();
    if (!schema) {
      return res.status(500).json({ error: 'Custom spell SQL schema unavailable' });
    }

    const templateRow = await getCustomSpellRow(templateSpellId);
    if (!templateRow) {
      return res.status(404).json({ error: 'Template spell not found' });
    }

    const existingRow = await getCustomSpellRow(newSpellId);
    if (existingRow) {
      return res.status(409).json({ error: `Spell ID ${newSpellId} already exists` });
    }

    const insertResult = await withCustomSpellConnection(async (conn) => {
      const newRow = { ...templateRow, ID: Math.trunc(newSpellId) };
      const columns = Object.keys(newRow);
      const placeholders = columns.map(() => '?').join(', ');
      const values = columns.map((c) => newRow[c]);
      await conn.query(
        `INSERT INTO \`${CUSTOM_SPELL_DB}\`.\`spell\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES (${placeholders})`,
        values
      );
      return { mirrored: true, mode: 'insert', columns };
    });

    const mirrorResult = await mirrorSpellToCustomTable(newSpellId, normalizeSpellPatchFields(fields || {}))
      .catch(() => ({ mirrored: false, reason: 'mirror-failed' }));

    // Best-effort only: a brand-new spell ID has no existing Spell.dbc
    // record to patch fields into (that would require appending a whole new
    // record, a separate/riskier operation not attempted here) - so this
    // will correctly report 'spell-not-in-dbc' for genuinely new IDs rather
    // than silently claiming success.
    let dbcPatch;
    try {
      dbcPatch = patchSpellDbcFromSql(newSpellId, normalizeSpellPatchFields(fields || {}));
    } catch (err) {
      dbcPatch = { patched: false, reason: `patch-threw: ${err.message}` };
    }

    const details = await buildSqlOnlySpellDetails(newSpellId);

    return res.json({
      success: true,
      templateSpellId,
      newSpellId,
      updatedFields: mirrorResult?.columns || [],
      skipped: [],
      mirror: { created: insertResult, patch: mirrorResult },
      dbcPatch,
      details,
    });
  } catch (error) {
    console.error('Error creating spell from template:', error);
    logErrorToFile(`Error creating spell from template: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/spell-suggest-id', (req, res) => {
  (async () => {
    try {
      const schema = await loadCustomSpellSchema();
      if (!schema) {
        return res.status(500).json({ error: 'Custom spell SQL schema unavailable' });
      }

      const stats = await withCustomSpellConnection(async (conn) => {
        const [rows] = await conn.query(`SELECT MIN(\`ID\`) AS minId, MAX(\`ID\`) AS maxId FROM \`${CUSTOM_SPELL_DB}\`.\`spell\``);
        return Array.isArray(rows) && rows.length ? rows[0] : { minId: null, maxId: null };
      });

      const minId = Number(stats?.minId || 1);
      const maxId = Number(stats?.maxId || 0);
      const preferredFloor = Math.max(900000, maxId - 50000);
      const suggestion = Math.max(preferredFloor, maxId + 1);

      return res.json({
        suggestion,
        minExistingId: minId,
        maxExistingId: maxId,
        preferredFloor,
      });
    } catch (error) {
      console.error('Error suggesting free spell ID:', error);
      logErrorToFile(`Error suggesting free spell ID: ${error.stack || error}`);
      return res.status(500).json({ error: error.message });
    }
  })();
});

app.post('/api/spells/batch-edit', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.spellIds) ? req.body.spellIds.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0) : [];
    const fields = req.body?.fields;

    if (!ids.length) return res.status(400).json({ error: 'No spell IDs provided' });
    if (!fields || typeof fields !== 'object') return res.status(400).json({ error: 'Missing fields payload' });

    const existingRows = await withCustomSpellConnection(async (conn) => {
      const [rows] = await conn.query(
        `SELECT \`ID\` FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` WHERE \`ID\` IN (?)`,
        [ids]
      );
      return Array.isArray(rows) ? rows : [];
    });

    const existingIds = new Set(existingRows.map((r) => Number(r.ID)));
    const missing = ids.filter((id) => !existingIds.has(id));

    const normalizedFields = normalizeSpellPatchFields(fields);
    const mirrorResults = await Promise.all(
      ids
        .filter((id) => existingIds.has(id))
        .map((spellId) => mirrorSpellToCustomTable(spellId, normalizedFields).catch(() => ({ mirrored: false, reason: 'mirror-failed', spellId })))
    );

    const updatedSpells = mirrorResults.filter((r) => r?.mirrored).length;
    const updatedFields = Array.from(
      new Set(mirrorResults.flatMap((r) => (Array.isArray(r?.columns) ? r.columns : [])))
    );

    if (!updatedSpells) {
      return res.status(400).json({ error: 'No spells updated', missing, skipped: [] });
    }

    const dbcPatchResults = ids
      .filter((id) => existingIds.has(id))
      .map((spellId) => {
        try {
          return { spellId, ...patchSpellDbcFromSql(spellId, normalizedFields) };
        } catch (err) {
          return { spellId, patched: false, reason: `patch-threw: ${err.message}` };
        }
      });

    return res.json({
      success: true,
      updatedSpells,
      requestedSpells: ids.length,
      updatedFields,
      missing,
      skipped: [],
      mirror: mirrorResults,
      dbcPatch: dbcPatchResults,
    });
  } catch (error) {
    console.error('Error applying spell SQL batch edit:', error);
    logErrorToFile(`Error applying spell SQL batch edit: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});


// Health/status endpoint for file service and configured paths
app.get('/api/file-service-status', (req, res) => {
  try {
    const config = loadConfigFile();
    const checks = [
      {
        key: 'base.dbc',
        path: path.join(PUBLIC_DIR, config.paths.base.dbc),
      },
      {
        key: 'base.icons',
        path: path.join(PUBLIC_DIR, config.paths.base.icons),
      },
    ].map((entry) => ({
      ...entry,
      exists: fs.existsSync(entry.path),
    }));

    const active = {
      dbc: getActiveDBCDir(config),
      icons: getActiveIconDir(config),
    };

    res.json({
      ok: true,
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      config,
      active,
      checks,
      missing: checks.filter((entry) => !entry.exists).map((entry) => entry.key),
      watcher: {
        status: 'not-applicable',
        message: 'Watcher is managed by the Vite dev server (npm run dev). Restart it if a watched path was renamed or deleted.',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error building file service status:', error);
    logErrorToFile(`Error building file service status: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Resolve icon filename case-insensitively
app.get('/api/resolve-icon/:folder/:iconName', (req, res) => {
  try {
    const { folder, iconName } = req.params;
    const config = loadConfigFile();
    
    // Security: only allow icon folder
    if (folder !== 'icon' && folder !== 'Icon' && folder !== 'Icons') {
      return res.status(403).json({ error: 'Only icon folder allowed' });
    }
    
    const folderPath = path.join(PUBLIC_DIR, getBaseIconDir(config));
    
    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    
    // Read all files in the folder
    const files = fs.readdirSync(folderPath);
    
    // Find case-insensitive match
    const lowerSearch = iconName.toLowerCase();
    const matched = files.find(f => f.toLowerCase() === lowerSearch || f.toLowerCase() === `${lowerSearch}.blp` || f.toLowerCase() === `${lowerSearch}.BLP`);
    
    if (matched) {
      res.json({ found: true, filename: matched });
    } else {
      res.json({ found: false, filename: null });
    }
  } catch (error) {
    console.error('Error resolving icon:', error);
    logErrorToFile(`Error resolving icon: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Copy files from base to custom
app.post('/api/copy-files', (req, res) => {
  try {
    const { source, destination, type } = req.body;

    if (!source || !destination) {
      return res.status(400).json({ error: 'Source and destination required' });
    }

    const sourcePath = path.join(PUBLIC_DIR, source);
    const destPath = path.join(PUBLIC_DIR, destination);

    // Security: Ensure paths are within PUBLIC_DIR
    if (!sourcePath.includes(PUBLIC_DIR) || !destPath.includes(PUBLIC_DIR)) {
      return res.status(403).json({ error: 'Invalid path' });
    }

    // Create destination folder if it doesn't exist
    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destPath, { recursive: true });
    }

    if (type === 'dbc') {
      // Copy SpellIcon.dbc
      const dbcSource = path.join(sourcePath, 'SpellIcon.dbc');
      const dbcDest = path.join(destPath, 'SpellIcon.dbc');

      console.log(`Copying DBC: ${dbcSource} -> ${dbcDest}`);

      if (!fs.existsSync(dbcSource)) {
        return res.status(404).json({ error: `SpellIcon.dbc not found at ${dbcSource}` });
      }

      try {
        fs.copyFileSync(dbcSource, dbcDest);
        console.log('✓ DBC file copied successfully');
        return res.json({ success: true, message: 'DBC file copied' });
      } catch (err) {
        console.error('DBC copy error:', err);
        return res.status(500).json({ error: `Failed to copy DBC: ${err.message}` });
      }
    } else if (type === 'icons') {
      // Handle nested Icons folder (INT_335_wotlk/Icons/)
      let iconSourcePath = sourcePath;
      if (sourcePath.includes('INT_335_wotlk')) {
        iconSourcePath = path.join(sourcePath, 'Icons');
      }

      console.log(`Copying icons: ${iconSourcePath} -> ${destPath}`);

      if (!fs.existsSync(iconSourcePath)) {
        return res.status(404).json({ 
          error: `Icons folder not found at ${iconSourcePath}`,
          expected: iconSourcePath,
          source: sourcePath
        });
      }

      try {
        const files = fs.readdirSync(iconSourcePath);
        const blpFiles = files.filter(f => f.toLowerCase().endsWith('.blp'));

        if (blpFiles.length === 0) {
          return res.status(404).json({ error: 'No .blp files found in source' });
        }

        let copied = 0;
        const errors = [];

        blpFiles.forEach(file => {
          try {
            const src = path.join(iconSourcePath, file);
            const dest = path.join(destPath, file);
            const stat = fs.statSync(src);
            
            if (stat.isFile()) {
              fs.copyFileSync(src, dest);
              copied++;
            }
          } catch (err) {
            errors.push(`${file}: ${err.message}`);
          }
        });

        console.log(`✓ Copied ${copied} icon files`);
        
        if (errors.length > 0) {
          console.warn('Copy errors:', errors);
        }

        return res.json({ 
          success: true, 
          message: `${copied} icon files copied`,
          copied,
          errors: errors.length > 0 ? errors : undefined
        });
      } catch (err) {
        console.error('Icons copy error:', err);
        return res.status(500).json({ error: `Failed to copy icons: ${err.message}` });
      }
    }

    res.status(400).json({ error: 'Invalid type' });
  } catch (error) {
    console.error('Copy error:', error);
    logErrorToFile(`Copy error: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Check if files exist
app.get('/api/check-files', (req, res) => {
  try {
    const config = loadConfigFile();
    const dbcPath = resolveDbcPath(config, 'SpellIcon.dbc');
    const iconsPath = path.join(PUBLIC_DIR, getBaseIconDir(config));

    const dbcExists = fs.existsSync(dbcPath);
    
    let iconCount = 0;
    if (fs.existsSync(iconsPath)) {
      try {
        const files = fs.readdirSync(iconsPath);
        iconCount = files.filter(f => f.toLowerCase().endsWith('.blp')).length;
      } catch (err) {
        console.error('Error reading icons folder:', err);
      }
    }

    console.log(`File check: DBC=${dbcExists}, Icons=${iconCount}`);

    res.json({
      dbcExists,
      iconCount,
      iconsExist: iconCount > 0,
    });
  } catch (error) {
    console.error('Check error:', error);
    logErrorToFile(`Check error: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Upload and convert icon
app.post('/api/upload-icon', (req, res) => {
  try {
    const { filename, blpData } = req.body;

    if (!filename || !blpData) {
      return res.status(400).json({ error: 'Filename and BLP data required' });
    }

    // Clean filename and ensure it's lowercase
    const cleanName = filename
      .toLowerCase()
      .replace(/\.[^/.]+$/, '') // Remove extension
      .replace(/[^a-z0-9_]/g, '_'); // Replace invalid chars

    const prefixedName = cleanName.startsWith('custom-') ? cleanName : `custom-${cleanName}`;
    const finalFilename = `${prefixedName}.blp`;
    const config = loadConfigFile();
    const iconDir = getIconDirPath(config);
    const destPath = path.join(iconDir, finalFilename);
    const exportIconDir = path.join(EXPORT_DIR, 'Interface', 'Icons');
    const exportDbcDir = path.join(EXPORT_DIR, 'DBFilesClient');
    const exportDbcPath = path.join(exportDbcDir, 'SpellIcon.dbc');
    const baseSpellIconPath = path.join(PUBLIC_DIR, getBaseDBCDir(config), 'SpellIcon.dbc');

    if (!fs.existsSync(iconDir)) {
      fs.mkdirSync(iconDir, { recursive: true });
    }
    if (!fs.existsSync(exportIconDir)) {
      fs.mkdirSync(exportIconDir, { recursive: true });
    }
    if (!fs.existsSync(exportDbcDir)) {
      fs.mkdirSync(exportDbcDir, { recursive: true });
    }

    console.log(`Uploading icon: ${finalFilename}`);

    // Convert base64 to buffer and write
    const buffer = Buffer.from(blpData, 'base64');
    fs.writeFileSync(destPath, buffer);
    fs.copyFileSync(destPath, path.join(exportIconDir, finalFilename));

    console.log(`✓ Icon uploaded: ${finalFilename} (${buffer.length} bytes)`);

    // Initialize or update DBC with new icon
    if (!fs.existsSync(exportDbcPath)) {
      if (fs.existsSync(baseSpellIconPath)) {
        fs.copyFileSync(baseSpellIconPath, exportDbcPath);
      } else {
        initializeSpellIconDbc(exportDbcPath);
      }
    }
    const iconDbcResult = addIconToSpellIconDbc(exportDbcPath, finalFilename);
    if (iconDbcResult && iconDbcResult.success && iconDbcResult.id != null) {
      // Keep sdbeditor.spellicon in sync immediately so this icon isn't
      // treated as "unknown to SQL" by the quarantine safety net.
      upsertSpellIconRows([{ id: iconDbcResult.id, name: iconDbcResult.filename || cleanName }])
        .catch(err => console.error('Failed to sync uploaded icon to SQL:', err.message));
    }

    // Trigger full manifest update in background (return immediately, update in progress)
    loadIconListCache(iconDir);
    iconListCache.add(finalFilename);
    const iconList = persistIconListCache();
    updateFullManifest(iconDir, exportDbcPath, { iconList, skipThumbnails: true })
      .catch(err => console.error('Background manifest update failed:', err));

    res.json({
      success: true,
      message: 'Icon uploaded, manifests updating...',
      filename: finalFilename,
      size: buffer.length,
    });
  } catch (error) {
    console.error('Upload error:', error);
    logErrorToFile(`Upload error: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Bulk sync SpellIcon.dbc with Icons folder (writes to export)
app.post('/api/spell-icon-dbc/sync', (req, res) => {
  try {
    const config = loadConfigFile();
    const iconDir = getIconDirPath(config);
    const sourceDbcPath = path.join(PUBLIC_DIR, getBaseDBCDir(config), 'SpellIcon.dbc');
    const outputDbcPath = path.join(EXPORT_DIR, 'DBFilesClient', 'SpellIcon.dbc');

    const iconList = loadOrBuildIconList(iconDir);
    const result = syncSpellIconDbcFromIcons(sourceDbcPath, iconDir, outputDbcPath, iconList);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error) {
    console.error('SpellIcon bulk sync error:', error);
    logErrorToFile(`SpellIcon bulk sync error: ${error.stack || error}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload header image
app.post('/api/upload-header-image', (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uploadedFile = req.files.file;
    const headerPath = path.join(PUBLIC_DIR, 'header-image.png');

    // Write file to public directory
    uploadedFile.mv(headerPath, (err) => {
      if (err) {
        console.error('Header upload error:', err);
        return res.status(500).json({ error: err.message });
      }

      console.log(`✓ Header image uploaded (${uploadedFile.size} bytes)`);
      res.json({ success: true, message: 'Header image uploaded' });
    });
  } catch (error) {
    console.error('Header upload error:', error);
    logErrorToFile(`Header upload error: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Upload background image
app.post('/api/upload-background-image', (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uploadedFile = req.files.file;
    const backgroundPath = path.join(PUBLIC_DIR, 'background-image.png');

    uploadedFile.mv(backgroundPath, (err) => {
      if (err) {
        console.error('Background upload error:', err);
        return res.status(500).json({ error: err.message });
      }

      console.log(`✓ Background image uploaded (${uploadedFile.size} bytes)`);
      res.json({ success: true, message: 'Background image uploaded' });
    });
  } catch (error) {
    console.error('Background upload error:', error);
    logErrorToFile(`Background upload error: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Clear background image
app.post('/api/clear-background-image', (req, res) => {
  try {
    const backgroundPath = path.join(PUBLIC_DIR, 'background-image.png');
    
    if (fs.existsSync(backgroundPath)) {
      fs.unlinkSync(backgroundPath);
      console.log(`✓ Background image cleared`);
    }
    
    res.json({ success: true, message: 'Background image cleared' });
  } catch (error) {
    console.error('Background clear error:', error);
    logErrorToFile(`Background clear error: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Upload page icon
app.post('/api/upload-page-icon', (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      console.error('No file uploaded');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uploadedFile = req.files.file;
    const fileName = uploadedFile.name.toLowerCase();
    
    // Support both .ico and .png formats
    let savePath;
    if (fileName.endsWith('.ico')) {
      savePath = path.join(PUBLIC_DIR, 'page-icon.ico');
    } else {
      savePath = path.join(PUBLIC_DIR, 'page-icon.png');
    }

    console.log(`Uploading icon: ${fileName} to ${savePath}`);

    uploadedFile.mv(savePath, (err) => {
      if (err) {
        console.error('Page icon move error:', err);
        return res.status(500).json({ error: 'Failed to save icon: ' + err.message });
      }

      console.log(`✓ Page icon uploaded (${uploadedFile.size} bytes) as ${path.basename(savePath)}`);
      res.json({ success: true, message: 'Page icon uploaded', filename: path.basename(savePath) });
    });
  } catch (error) {
    console.error('Page icon upload error:', error);
    logErrorToFile(`Page icon upload error: ${error.stack || error}`);
    res.status(500).json({ error: 'Upload error: ' + error.message });
  }
});

// Clear page icon
app.post('/api/clear-page-icon', (req, res) => {
  try {
    // Try both .png and .ico formats
    const icoPath = path.join(PUBLIC_DIR, 'page-icon.ico');
    const pngPath = path.join(PUBLIC_DIR, 'page-icon.png');
    
    let cleared = false;
    
    if (fs.existsSync(icoPath)) {
      fs.unlinkSync(icoPath);
      console.log(`✓ Page icon cleared (.ico)`);
      cleared = true;
    }
    
    if (fs.existsSync(pngPath)) {
      fs.unlinkSync(pngPath);
      console.log(`✓ Page icon cleared (.png)`);
      cleared = true;
    }
    
    if (!cleared) {
      console.log('No page icon file found to clear');
    }
    
    res.json({ success: true, message: 'Page icon cleared' });
  } catch (error) {
    console.error('Page icon clear error:', error);
    logErrorToFile(`Page icon clear error: ${error.stack || error}`);
    res.status(500).json({ error: 'Clear error: ' + error.message });
  }
});

// Self-restart endpoint
app.post('/api/self-restart', (req, res) => {
  console.log('File service self-restart requested');
  res.json({ message: 'Restarting file service...' });
  
  setTimeout(() => {
    console.log('Exiting for restart');
    process.exit(0);
  }, 500);
});

// Export custom icons to module export folder
app.post('/api/export-icons', (req, res) => {
  try {
    const config = loadConfigFile();
    const customIconsPath = path.join(PUBLIC_DIR, getBaseIconDir(config));
    const exportIconsPath = path.join(EXPORT_DIR, 'Interface', 'Icons');

    // Create export folder if it doesn't exist
    if (!fs.existsSync(exportIconsPath)) {
      fs.mkdirSync(exportIconsPath, { recursive: true });
    }

    // Get list of custom icon files
    if (!fs.existsSync(customIconsPath)) {
      return res.status(400).json({ error: `${customIconsPath} folder does not exist` });
    }

    const files = fs.readdirSync(customIconsPath);
    const supportedFormats = ['.png', '.jpg', '.jpeg', '.blp'];
    const iconFiles = files.filter(f =>
      f.toLowerCase().startsWith('custom-')
      && supportedFormats.some(ext => f.toLowerCase().endsWith(ext))
    );

    if (iconFiles.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No custom icons to export',
        exported: [],
        exportPath: '/root/azerothcore-wotlk/modules/mod-sdbeditor/export/Interface/Icons'
      });
    }

    // Copy icon files to export folder
    const exported = [];
    iconFiles.forEach(file => {
      const srcFile = path.join(customIconsPath, file);
      let destFile = path.join(exportIconsPath, file);
      
      // Change extension to .blp for output (preparation for conversion)
      const baseName = path.basename(file, path.extname(file));
      destFile = path.join(exportIconsPath, `${baseName}.blp`);
      
      try {
        fs.copyFileSync(srcFile, destFile);
        console.log(`✓ Exported icon: ${file} → ${baseName}.blp`);
        exported.push(file);
      } catch (err) {
        console.error(`Failed to export icon ${file}:`, err);
      }
    });

    res.json({ 
      success: true, 
      message: `Exported ${exported.length} icons`,
      exported,
      exportPath: '/root/azerothcore-wotlk/modules/mod-sdbeditor/export/Interface/Icons',
      note: 'Only custom-* icons are exported to Interface/Icons.'
    });
  } catch (error) {
    console.error('Icon export error:', error);
    logErrorToFile(`Icon export error: ${error.stack || error}`);
    res.status(500).json({ error: 'Export error: ' + error.message });
  }
});

function runSpellDbcLocalePreflight(spellDbcPath, { dryRun = false } = {}) {
  if (!spellDbcPath || !fs.existsSync(spellDbcPath)) {
    return {
      ok: false,
      error: `Spell.dbc not found at ${spellDbcPath || '(unknown path)'}`,
      spellDbcPath,
      dryRun,
    };
  }

  if (!fs.existsSync(SPELL_DBC_FIXER_PATH)) {
    return {
      ok: false,
      error: `Spell.dbc fixer script not found at ${SPELL_DBC_FIXER_PATH}`,
      spellDbcPath,
      dryRun,
    };
  }

  const args = [SPELL_DBC_FIXER_PATH, '--json'];
  if (dryRun) args.push('--dry-run');
  args.push(spellDbcPath);

  const result = spawnSync('python3', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });

  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  let payload = null;

  if (stdout) {
    try {
      payload = JSON.parse(stdout);
    } catch (err) {
      payload = null;
    }
  }

  return {
    ok: result.status !== null && result.status !== 2,
    exitCode: result.status,
    signal: result.signal,
    payload,
    stdout,
    stderr,
    spellDbcPath,
    dryRun,
  };
}

function importServerDbcFiles(config) {
  const publicDbcPath = path.join(PUBLIC_DIR, getBaseDBCDir(config));

  let sourceDir = SERVER_DBC_DIR;
  let sourceLabel = 'server';
  if (!fs.existsSync(sourceDir)) {
    sourceDir = BACKUP_DBC_DIR;
    sourceLabel = 'backup';
  }

  if (!fs.existsSync(publicDbcPath)) {
    fs.mkdirSync(publicDbcPath, { recursive: true });
  }

  if (!fs.existsSync(sourceDir)) {
    return {
      success: false,
      error: `DBC source folder not found: ${SERVER_DBC_DIR} or ${BACKUP_DBC_DIR}`,
      source: sourceDir,
      sourceLabel,
    };
  }

  const files = fs.readdirSync(sourceDir);
  const dbcFiles = files.filter(f => f.toLowerCase().endsWith('.dbc'));

  if (dbcFiles.length === 0) {
    return {
      success: true,
      message: `No DBC files found in ${sourceLabel} folder`,
      imported: [],
      skipped: 0,
      total: 0,
      source: sourceDir,
      sourceLabel,
      spellIconEntries: 0,
      spellNameEntries: 0,
      spellDbcFound: false,
      spellIconDbcFound: false,
    };
  }

  const imported = [];
  const skipped = [];
  dbcFiles.forEach(file => {
    const srcFile = path.join(sourceDir, file);
    const destFile = path.join(publicDbcPath, file);

    try {
      const srcStats = fs.statSync(srcFile);
      const destExists = fs.existsSync(destFile);

      if (!destExists) {
        fs.copyFileSync(srcFile, destFile);
        imported.push({ file, size: srcStats.size, status: 'new' });
      } else {
        const destStats = fs.statSync(destFile);
        if (srcStats.size !== destStats.size || srcStats.mtimeMs > destStats.mtimeMs) {
          fs.copyFileSync(srcFile, destFile);
          imported.push({ file, size: srcStats.size, status: 'updated' });
        } else {
          skipped.push(file);
        }
      }
    } catch (err) {
      console.error(`Failed to import DBC ${file}:`, err);
    }
  });

  if (imported.length > 0) {
    dbcCache.talents = null;
    dbcCache.talentTabs = null;
    dbcCache.spellIconIndex = null;
    dbcCache.spellNameIndex = null;
    if (dbcCache.lastModified) {
      dbcCache.lastModified.talentDbc = 0;
      dbcCache.lastModified.talentTabDbc = 0;
    }
  }

  let spellIconEntries = 0;
  let spellNameEntries = 0;
  let spellDbcFound = false;
  let spellIconDbcFound = false;
  try {
    const spellDbcPath = path.join(publicDbcPath, 'Spell.dbc');
    const spellIconDbcPath = path.join(publicDbcPath, 'SpellIcon.dbc');
    spellDbcFound = fs.existsSync(spellDbcPath);
    spellIconDbcFound = fs.existsSync(spellIconDbcPath);

    const iconIndex = buildSpellIconIndex(config);
    const nameEntries = buildSpellNameIndex(config);
    spellIconEntries = iconIndex ? Object.keys(iconIndex).length : 0;
    spellNameEntries = nameEntries ? nameEntries.length : 0;
  } catch (err) {
    console.error('DBC sync index rebuild error:', err);
  }

  return {
    success: true,
    message: `Imported ${imported.length} DBC files, ${skipped.length} already up to date`,
    imported,
    skipped: skipped.length,
    total: dbcFiles.length,
    source: sourceDir,
    sourceLabel,
    spellIconEntries,
    spellNameEntries,
    spellDbcFound,
    spellIconDbcFound,
  };
}

// Import/sync DBC files from the server's data folder into public/dbc
app.post('/api/import-server-dbc', (req, res) => {
  try {
    const config = loadConfigFile();
    const result = importServerDbcFiles(config);
    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Failed to import DBC files', ...result });
    }

    console.log(`✓ ${result.message}`);
    res.json(result);
  } catch (error) {
    console.error('DBC import error:', error);
    logErrorToFile(`DBC import error: ${error.stack || error}`);
    res.status(500).json({ error: 'Import error: ' + error.message });
  }
});

const UNLISTED_ICON_SUBDIR = '_unlisted';

// Lowercase, extension-stripped, path-stripped key — matches how icon
// FILENAMES are normalized on disk (see dbc-updater.js's normalizeIconName).
// Used for file <-> SQL matching in the quarantine safety net.
function normalizeIconFileKey(input) {
  if (!input) return '';
  let name = String(input).replace(/\\/g, '/');
  if (name.includes('/')) name = name.substring(name.lastIndexOf('/') + 1);
  name = name.toLowerCase();
  name = name.replace(/\.blp$/i, '');
  return name.trim();
}

// Case-preserving, extension-stripped, path-stripped key — matches the
// existing binary-DBC-derived spell-icon index contract (frontend builds
// thumbnail URLs directly from this casing).
function iconIndexKeyFromSqlName(input) {
  if (!input) return '';
  let name = String(input).replace(/\\/g, '/');
  if (name.includes('/')) name = name.substring(name.lastIndexOf('/') + 1);
  name = name.replace(/\.[^.]+$/, '');
  return name.trim();
}

function buildSpellIconSqlPath(baseName) {
  return `Interface\\Icons\\${baseName}`;
}

// Resolve a single SpellIconID -> normalized icon base name via the
// sdbeditor.spellicon SQL mirror. Used so the editor's own preview reflects
// an in-progress SpellIconID edit immediately, without needing a full
// DBC/index rebuild first (spellIconIndex is only rebuilt from the binary
// Spell.dbc/SpellIcon.dbc, or via the explicit sync workflow).
async function getSpellIconNameById(spellIconId) {
  const id = Number(spellIconId);
  if (!Number.isFinite(id) || id <= 0) return null;
  try {
    const rows = await withCustomSpellConnection(async (conn) => {
      const [r] = await conn.query(
        `SELECT \`Name\` AS iconName FROM \`${CUSTOM_SPELL_DB}\`.\`spellicon\` WHERE \`ID\` = ? LIMIT 1`,
        [id]
      );
      return r;
    });
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    return row ? iconIndexKeyFromSqlName(row.iconName) : null;
  } catch {
    return null;
  }
}

// Build the spellId -> iconBaseName map directly from sdbeditor SQL
// (spell.SpellIconID -> spellicon.Name), avoiding a binary DBC parse.
// Returns null if the sdbeditor DB is unreachable or empty (caller should
// fall back to the binary-DBC-based buildSpellIconIndex()).
async function buildSpellIconIndexFromSql(config) {
  try {
    const rows = await withCustomSpellConnection(async (conn) => {
      const [r] = await conn.query(
        `SELECT s.\`ID\` AS spellId, si.\`Name\` AS iconName
         FROM \`${CUSTOM_SPELL_DB}\`.\`spell\` s
         INNER JOIN \`${CUSTOM_SPELL_DB}\`.\`spellicon\` si ON si.\`ID\` = s.\`SpellIconID\`
         WHERE si.\`Name\` IS NOT NULL AND si.\`Name\` <> ''`
      );
      return r;
    });
    if (!rows || !rows.length) return null;

    const index = {};
    for (const row of rows) {
      const key = iconIndexKeyFromSqlName(row.iconName);
      if (key) index[Number(row.spellId)] = key;
    }
    return index;
  } catch (err) {
    console.error('⚠ Failed to build spell-icon index from SQL:', err.message);
    return null;
  }
}

// Write a pre-built spell-icon index to the same disk cache path/shape that
// buildSpellIconIndex() uses, so every other consumer (loadOrBuildSpellIconIndex,
// Talent API, Spell Editor lookups) transparently picks up SQL-sourced data
// without needing to re-parse Spell.dbc/SpellIcon.dbc themselves.
function persistSpellIconIndexToDisk(index, extraMeta = {}) {
  const meta = {
    builtAt: new Date().toISOString(),
    spellCount: Object.keys(index).length,
    ...extraMeta,
  };
  const payload = { meta, index };
  fs.writeFileSync(SPELL_ICON_INDEX_PATH, JSON.stringify(payload));
  dbcCache.spellIconIndex = index;
  return payload;
}

// Push newly-assigned SpellIcon.dbc entries (from syncSpellIconDbcFromIcons)
// into sdbeditor.spellicon so brand-new custom icons are immediately known
// to SQL, before the quarantine safety net runs.
async function upsertSpellIconRows(entries) {
  if (!Array.isArray(entries) || !entries.length) return { upserted: 0 };
  try {
    const result = await withCustomSpellConnection(async (conn) => {
      for (const entry of entries) {
        await conn.query(
          `INSERT INTO \`${CUSTOM_SPELL_DB}\`.\`spellicon\` (\`ID\`, \`Name\`) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE \`Name\` = VALUES(\`Name\`)`,
          [entry.id, buildSpellIconSqlPath(entry.name)]
        );
      }
      return { upserted: entries.length };
    });
    return result || { upserted: 0, error: 'sdbeditor SQL connection unavailable' };
  } catch (err) {
    console.error('⚠ Failed to upsert spellicon SQL rows:', err.message);
    return { upserted: 0, error: err.message };
  }
}

// Icon safety net: quarantine any icon file in the main Icons folder whose
// name isn't referenced by any row in sdbeditor.spellicon into a sibling
// "_unlisted" folder (keeping the main folder limited to SQL-known icons),
// and restore any previously-quarantined file that IS now referenced.
async function runIconQuarantine(config) {
  const iconDir = getIconDirPath(config);
  const unlistedDir = path.join(iconDir, UNLISTED_ICON_SUBDIR);

  if (!fs.existsSync(iconDir)) {
    return { success: false, error: `Icon directory not found: ${iconDir}` };
  }

  let knownRows;
  try {
    knownRows = await withCustomSpellConnection(async (conn) => {
      const [rows] = await conn.query(
        `SELECT \`Name\` FROM \`${CUSTOM_SPELL_DB}\`.\`spellicon\` WHERE \`Name\` IS NOT NULL AND \`Name\` <> ''`
      );
      return rows;
    });
  } catch (err) {
    return { success: false, error: `sdbeditor SQL query failed: ${err.message}` };
  }

  if (!knownRows) {
    return { success: false, skipped: true, error: 'sdbeditor SQL connection unavailable; skipped icon quarantine' };
  }

  const knownSet = new Set(knownRows.map((r) => normalizeIconFileKey(r.Name)).filter(Boolean));

  if (!fs.existsSync(unlistedDir)) {
    fs.mkdirSync(unlistedDir, { recursive: true });
  }

  const mainFiles = fs.readdirSync(iconDir).filter((f) => f.toLowerCase().endsWith('.blp'));
  const quarantined = [];
  for (const file of mainFiles) {
    if (!knownSet.has(normalizeIconFileKey(file))) {
      try {
        fs.renameSync(path.join(iconDir, file), path.join(unlistedDir, file));
        quarantined.push(file);
      } catch (err) {
        console.error(`Failed to quarantine icon ${file}:`, err.message);
      }
    }
  }

  const unlistedFiles = fs.readdirSync(unlistedDir).filter((f) => f.toLowerCase().endsWith('.blp'));
  const restored = [];
  for (const file of unlistedFiles) {
    if (knownSet.has(normalizeIconFileKey(file))) {
      try {
        fs.renameSync(path.join(unlistedDir, file), path.join(iconDir, file));
        restored.push(file);
      } catch (err) {
        console.error(`Failed to restore icon ${file}:`, err.message);
      }
    }
  }

  if (quarantined.length || restored.length) {
    try {
      loadIconListCache(iconDir);
      persistIconListCache();
    } catch (err) {
      console.error('Failed to refresh icon list cache after quarantine:', err.message);
    }
  }

  return {
    success: true,
    knownIconCount: knownSet.size,
    mainFolderCount: mainFiles.length - quarantined.length + restored.length,
    quarantinedCount: quarantined.length,
    quarantined,
    restoredCount: restored.length,
    restored,
    unlistedDir,
  };
}

app.post('/api/icon-quarantine/run', async (req, res) => {
  try {
    const config = loadConfigFile();
    const result = await runIconQuarantine(config);
    if (!result.success) {
      return res.status(result.skipped ? 200 : 400).json(result);
    }
    res.json(result);
  } catch (error) {
    console.error('Icon quarantine error:', error);
    logErrorToFile(`Icon quarantine error: ${error.stack || error}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// List icons currently sitting in the "_unlisted" quarantine folder so the
// UI can offer a quick multi-select "Import" workflow.
app.get('/api/unlisted-icons', (req, res) => {
  try {
    const config = loadConfigFile();
    const iconDir = getIconDirPath(config);
    const unlistedDir = path.join(iconDir, UNLISTED_ICON_SUBDIR);

    if (!fs.existsSync(unlistedDir)) {
      return res.json({ files: [], count: 0, unlistedDir });
    }

    const files = fs.readdirSync(unlistedDir)
      .filter((f) => f.toLowerCase().endsWith('.blp'))
      .sort((a, b) => a.localeCompare(b));

    res.json({ files, count: files.length, unlistedDir });
  } catch (error) {
    console.error('List unlisted icons error:', error);
    logErrorToFile(`List unlisted icons error: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// One-click "add new icon" workflow for previously-quarantined files:
// assigns each selected icon a SpellIcon.dbc ID, upserts sdbeditor.spellicon,
// and moves the file back into the main Icons folder — replacing the old
// manual "drop file -> add to SQL -> add to DBC" 3-step process.
app.post('/api/unlisted-icons/import', async (req, res) => {
  try {
    const requested = Array.isArray(req.body?.files) ? req.body.files : [];
    if (!requested.length) {
      return res.status(400).json({ error: 'No files specified' });
    }

    const config = loadConfigFile();
    const iconDir = getIconDirPath(config);
    const unlistedDir = path.join(iconDir, UNLISTED_ICON_SUBDIR);
    const exportDbcDir = path.join(EXPORT_DIR, 'DBFilesClient');
    const exportDbcPath = path.join(exportDbcDir, 'SpellIcon.dbc');
    const baseSpellIconPath = path.join(PUBLIC_DIR, getBaseDBCDir(config), 'SpellIcon.dbc');

    if (!fs.existsSync(exportDbcDir)) {
      fs.mkdirSync(exportDbcDir, { recursive: true });
    }
    if (!fs.existsSync(exportDbcPath)) {
      if (fs.existsSync(baseSpellIconPath)) {
        fs.copyFileSync(baseSpellIconPath, exportDbcPath);
      } else {
        initializeSpellIconDbc(exportDbcPath);
      }
    }

    const imported = [];
    const failed = [];

    for (const rawName of requested) {
      const filename = path.basename(String(rawName || ''));
      if (!filename) {
        failed.push({ file: rawName, error: 'Invalid filename' });
        continue;
      }
      const srcPath = path.join(unlistedDir, filename);
      if (!fs.existsSync(srcPath)) {
        failed.push({ file: filename, error: 'File not found in _unlisted' });
        continue;
      }

      try {
        const dbcResult = addIconToSpellIconDbc(exportDbcPath, filename);
        if (!dbcResult || !dbcResult.success) {
          failed.push({ file: filename, error: 'Failed to add icon to SpellIcon.dbc' });
          continue;
        }

        const sqlResult = await upsertSpellIconRows([{ id: dbcResult.id, name: dbcResult.filename }]);
        fs.renameSync(srcPath, path.join(iconDir, filename));

        imported.push({
          file: filename,
          id: dbcResult.id,
          alreadyInDbc: !!dbcResult.skipped,
          sqlUpserted: !sqlResult?.error,
        });
      } catch (err) {
        failed.push({ file: filename, error: err.message });
      }
    }

    if (imported.length) {
      loadIconListCache(iconDir);
      for (const entry of imported) iconListCache.add(entry.file);
      persistIconListCache();
    }

    res.json({
      success: failed.length === 0,
      importedCount: imported.length,
      failedCount: failed.length,
      imported,
      failed,
    });
  } catch (error) {
    console.error('Import unlisted icons error:', error);
    logErrorToFile(`Import unlisted icons error: ${error.stack || error}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sync-workflow/run', async (req, res) => {
  try {
    const startTime = Date.now();
    const config = loadConfigFile();
    const options = {
      autoRepairLocaleOffsets: req.body?.autoRepairLocaleOffsets !== false,
      runSpellIconSync: req.body?.runSpellIconSync !== false,
      runIconQuarantine: req.body?.runIconQuarantine !== false,
    };

    const stages = [];

    const importStage = {
      name: 'import-server-dbc',
      ok: false,
      details: null,
    };
    const importResult = importServerDbcFiles(config);
    importStage.ok = !!importResult.success;
    importStage.details = importResult;
    stages.push(importStage);
    if (!importResult.success) {
      return res.status(400).json({
        success: false,
        options,
        durationMs: Date.now() - startTime,
        stages,
        error: importResult.error || 'Import stage failed',
      });
    }

    const publicSpellDbcPath = path.join(PUBLIC_DIR, getBaseDBCDir(config), 'Spell.dbc');
    const localePreflight = runSpellDbcLocalePreflight(publicSpellDbcPath, { dryRun: true });
    const localeStage = {
      name: 'spell-locale-preflight',
      ok: !!localePreflight.ok,
      details: {
        dryRun: localePreflight,
      },
    };

    if (localePreflight.ok
      && localePreflight.payload
      && Number(localePreflight.payload.fixedCount || 0) > 0
      && options.autoRepairLocaleOffsets) {
      const repair = runSpellDbcLocalePreflight(publicSpellDbcPath, { dryRun: false });
      localeStage.ok = !!repair.ok;
      localeStage.details.repair = repair;
    }
    stages.push(localeStage);

    // Spell-icon DBC sync runs BEFORE the quarantine safety net so brand-new
    // custom icons get assigned an ID + a sdbeditor.spellicon SQL row first —
    // otherwise they'd look "unknown to SQL" and get quarantined immediately.
    if (options.runSpellIconSync) {
      const spellIconStage = {
        name: 'spell-icon-sync',
        ok: false,
        details: null,
      };
      try {
        const iconDir = getIconDirPath(config);
        const sourceDbcPath = path.join(PUBLIC_DIR, getBaseDBCDir(config), 'SpellIcon.dbc');
        const outputDbcPath = path.join(EXPORT_DIR, 'DBFilesClient', 'SpellIcon.dbc');
        const iconList = loadOrBuildIconList(iconDir);
        const result = syncSpellIconDbcFromIcons(sourceDbcPath, iconDir, outputDbcPath, iconList);
        spellIconStage.ok = !!result.success;
        spellIconStage.details = result;

        if (result.success && Array.isArray(result.addedEntries) && result.addedEntries.length) {
          const sqlUpsert = await upsertSpellIconRows(result.addedEntries);
          spellIconStage.details.sqlUpsert = sqlUpsert;
        }
      } catch (err) {
        spellIconStage.ok = false;
        spellIconStage.details = { success: false, error: err.message };
      }
      stages.push(spellIconStage);
    }

    if (options.runIconQuarantine) {
      const quarantineStage = {
        name: 'icon-quarantine',
        ok: false,
        details: null,
      };
      try {
        const result = await runIconQuarantine(config);
        // Missing SQL connectivity is treated as a soft-skip, not a hard
        // failure, so the rest of the sync pipeline can still succeed.
        quarantineStage.ok = result.success || !!result.skipped;
        quarantineStage.details = result;
      } catch (err) {
        quarantineStage.ok = false;
        quarantineStage.details = { success: false, error: err.message };
      }
      stages.push(quarantineStage);
    }

    const indexStage = {
      name: 'rebuild-indexes',
      ok: false,
      details: null,
    };
    try {
      let iconIndex = await buildSpellIconIndexFromSql(config);
      let iconIndexSource = 'sql';
      if (iconIndex) {
        persistSpellIconIndexToDisk(iconIndex, { source: 'sql' });
      } else {
        iconIndex = buildSpellIconIndex(config);
        iconIndexSource = iconIndex ? 'dbc-binary-fallback' : 'unavailable';
      }
      const nameEntries = buildSpellNameIndex(config);
      indexStage.ok = true;
      indexStage.details = {
        spellIconEntries: iconIndex ? Object.keys(iconIndex).length : 0,
        spellIconSource: iconIndexSource,
        spellNameEntries: Array.isArray(nameEntries) ? nameEntries.length : 0,
      };
    } catch (err) {
      indexStage.ok = false;
      indexStage.details = { error: err.message };
    }
    stages.push(indexStage);

    const failedStage = stages.find((s) => !s.ok);
    return res.status(failedStage ? 400 : 200).json({
      success: !failedStage,
      options,
      durationMs: Date.now() - startTime,
      stages,
      active: {
        dbc: getActiveDBCDir(config),
        icons: getActiveIconDir(config),
      },
      exportPaths: {
        dbcs: path.join(EXPORT_DIR, 'DBFilesClient'),
        icons: path.join(EXPORT_DIR, 'Interface', 'Icons'),
      },
    });
  } catch (error) {
    console.error('Sync workflow error:', error);
    logErrorToFile(`Sync workflow error: ${error.stack || error}`);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Export edited DBCs (already stored in export/DBFilesClient)
// Accepts optional body { files: ['Talent.dbc', ...] } to filter
app.post('/api/export-dbc', (req, res) => {
  try {
    const exportDbcPath = path.join(EXPORT_DIR, 'DBFilesClient');

    // Create export folder if it doesn't exist
    if (!fs.existsSync(exportDbcPath)) {
      fs.mkdirSync(exportDbcPath, { recursive: true });
    }

    // Get list of custom DBC files
    if (!fs.existsSync(exportDbcPath)) {
      return res.status(400).json({ error: `${exportDbcPath} folder does not exist` });
    }

    const allFiles = fs.readdirSync(exportDbcPath);
    let dbcFiles = allFiles.filter(f => f.toLowerCase().endsWith('.dbc'));

    // Filter to specific files if requested
    const requestedFiles = req.body?.files;
    if (Array.isArray(requestedFiles) && requestedFiles.length > 0) {
      const requested = new Set(requestedFiles.map(f => f.toLowerCase()));
      dbcFiles = dbcFiles.filter(f => requested.has(f.toLowerCase()));
    }

    if (dbcFiles.length === 0) {
      return res.json({
        success: true,
        message: 'No edited DBCs to export',
        exported: [],
        exportPath: '/root/azerothcore-wotlk/modules/mod-sdbeditor/export/DBFilesClient'
      });
    }

    const exported = [];
    dbcFiles.forEach(file => {
      try {
        const srcFile = path.join(exportDbcPath, file);
        const srcSize = fs.statSync(srcFile).size;
        console.log(`✓ Exported DBC: ${file} (${srcSize} bytes)`);
        exported.push({ file, size: srcSize });
      } catch (err) {
        console.error(`Failed to export DBC ${file}:`, err);
      }
    });

    res.json({ 
      success: true, 
      message: `Exported ${exported.length} DBC files`,
      exported,
      exportPath: '/root/azerothcore-wotlk/modules/mod-sdbeditor/export/DBFilesClient',
      note: 'These can be placed directly in client DBFilesClient/ folder'
    });
  } catch (error) {
    console.error('DBC export error:', error);
    logErrorToFile(`DBC export error: ${error.stack || error}`);
    res.status(500).json({ error: 'Export error: ' + error.message });
  }
});

// Get export status (list files in export folders)
app.get('/api/export-status', (req, res) => {
  try {
    const iconPath = path.join(EXPORT_DIR, 'Interface', 'Icons');
    const dbcPath = path.join(EXPORT_DIR, 'DBFilesClient');

    const icons = fs.existsSync(iconPath) ? fs.readdirSync(iconPath) : [];
    const dbcs = fs.existsSync(dbcPath) ? fs.readdirSync(dbcPath) : [];

    res.json({
      success: true,
      icons: {
        count: icons.length,
        files: icons.slice(0, 10), // Show first 10
        hasMore: icons.length > 10
      },
      dbcs: {
        count: dbcs.length,
        files: dbcs,
      },
      exportPaths: {
        icons: '/root/azerothcore-wotlk/modules/mod-sdbeditor/export/Interface/Icons',
        dbcs: '/root/azerothcore-wotlk/modules/mod-sdbeditor/export/DBFilesClient'
      }
    });
  } catch (error) {
    console.error('Export status error:', error);
    logErrorToFile(`Export status error: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Initialize all required public directories
app.post('/api/initialize-folders', (req, res) => {
  try {
    const requiredDirs = [
      'dbc',
      'Icons',
      'thumbnails',
      'sprites',
      'error-logs',
    ];

    // Also ensure module-level export dirs exist
    const exportDirs = ['DBFilesClient', 'Interface'];
    for (const ed of exportDirs) {
      const ep = path.join(EXPORT_DIR, ed);
      if (!fs.existsSync(ep)) fs.mkdirSync(ep, { recursive: true });
    }

    const results = [];
    for (const dir of requiredDirs) {
      const fullPath = path.join(PUBLIC_DIR, dir);
      const existed = fs.existsSync(fullPath);
      if (!existed) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
      results.push({ dir, created: !existed, existed });
    }

    const created = results.filter(r => r.created).map(r => r.dir);
    const existed = results.filter(r => r.existed).map(r => r.dir);

    console.log(`✓ Initialize folders: ${created.length} created, ${existed.length} already existed`);
    res.json({ success: true, created, existed });
  } catch (error) {
    console.error('Initialize folders error:', error);
    logErrorToFile(`Initialize folders error: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Check which required directories exist
app.get('/api/initialize-folders/status', (req, res) => {
  try {
    const requiredDirs = [
      'dbc',
      'Icons',
      'thumbnails',
      'sprites',
      'error-logs',
    ];

    const status = requiredDirs.map(dir => ({
      dir,
      exists: fs.existsSync(path.join(PUBLIC_DIR, dir)),
    }));

    // Check module-level export dirs too
    ['DBFilesClient', 'Interface'].forEach(ed => {
      status.push({ dir: `export/${ed}`, exists: fs.existsSync(path.join(EXPORT_DIR, ed)) });
    });

    res.json({ status, allReady: status.every(s => s.exists) });
  } catch (error) {
    console.error('Folder status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Mount generic DBC editor API (must be before 404 handler)
app.use('/api/dbc', genericDbcRouter);

// Generate thumbnails on demand (must be before 404 handler)
app.post('/api/generate-thumbnails', async (req, res) => {
  try {
    const result = await generateThumbnailsForIcons();
    res.json(result);
  } catch (err) {
    console.error('Generate thumbnails error:', err);
    res.status(500).json({ error: 'Failed to generate thumbnails' });
  }
});

// Thumbnail API endpoints
// Note: /api/icon-manifest and /api/sprite-map are defined earlier in the file

// Trigger full manifest update (including thumbnails and DBC)
app.post('/api/update-manifest', async (req, res) => {
  try {
    console.log('🔄 Manifest update requested...');
    const config = loadConfigFile();
    const iconDir = getIconDirPath(config);
    const exportDbcPath = path.join(EXPORT_DIR, 'DBFilesClient', 'SpellIcon.dbc');
    const dbcPath = fs.existsSync(exportDbcPath)
      ? exportDbcPath
      : path.join(PUBLIC_DIR, getBaseDBCDir(config), 'SpellIcon.dbc');
    
    // Don't wait - return immediately with status
    res.json({
      status: 'updating',
      message: 'Manifest update in progress. Icons loading...',
      timestamp: new Date().toISOString()
    });

    // Run in background
    const iconList = loadOrBuildIconList(iconDir);
    updateFullManifest(iconDir, dbcPath, { iconList, skipThumbnails: true })
      .then(result => {
        console.log(`✅ Manifest update complete: ${result.generated} thumbnails, ${result.failed} failed`);
      })
      .catch(err => console.error('❌ Manifest update failed:', err));
  } catch (err) {
    console.error('Update manifest error:', err);
    res.status(500).json({ error: 'Failed to start manifest update' });
  }
});

app.get('/api/icon-thumbnails', (req, res) => {
  try {
    if (!fs.existsSync(THUMBNAILS_DIR)) {
      return res.json({ thumbnails: [] });
    }
    const files = fs.readdirSync(THUMBNAILS_DIR).filter(f => f.endsWith('.png'));
    const thumbnails = files.map(f => ({
      name: f.replace(/\.png$/i, ''),
      url: `/thumbnails/${f}`
    }));
    res.json({ thumbnails });
  } catch (err) {
    console.error('Failed to list thumbnails:', err);
    res.status(500).json({ error: 'Failed to list thumbnails' });
  }
});

app.post('/api/generate-thumbnails', async (req, res) => {
  try {
    const result = await generateThumbnailsForIcons();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Thumbnail generation failed:', err);
    res.status(500).json({ error: 'Thumbnail generation failed' });
  }
});

// Rebuild icon list cache from disk
app.post('/api/icon-list/rebuild', (req, res) => {
  try {
    const config = loadConfigFile();
    const iconDir = getIconDirPath(config);
    const list = loadOrBuildIconList(iconDir);
    iconListCache = new Set(list);
    res.json({ success: true, count: list.length, path: ICON_LIST_PATH });
  } catch (error) {
    console.error('Icon list rebuild failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET last-known-backup summary + full backup history, shown next to DBC Sync + Validation.
app.get('/api/dbc-backup/status', (req, res) => {
  try {
    const backups = listDbcBackups();
    res.json({
      success: true,
      lastBackup: backups[0] || null,
      count: backups.length,
      backups: backups.slice(0, 30),
    });
  } catch (error) {
    console.error('Error listing DBC backups:', error);
    logErrorToFile(`Error listing DBC backups: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// Manually trigger a DBC backup right now (always creates a new snapshot,
// distinct from the automatic once-per-day folder, using a timestamped name).
app.post('/api/dbc-backup/run', (req, res) => {
  try {
    const folderName = manualDbcBackupFolderName();
    const result = createDbcBackupSnapshot(folderName);
    res.json({
      success: true,
      lastBackup: {
        name: result.folderName,
        manual: true,
        mtime: new Date().toISOString(),
        fileCount: result.fileCount,
      },
    });
  } catch (error) {
    console.error('Manual DBC backup failed:', error);
    logErrorToFile(`Manual DBC backup failed: ${error.stack || error}`);
    res.status(500).json({ error: error.message });
  }
});

// 404 handler - return JSON instead of HTML
app.use((req, res) => {
  console.warn(`404: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  logErrorToFile(`Server error: ${err.stack || err}`);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ─── Daily DBC Backup ────────────────────────────────────────────────
// On first server start each day, back up all DBC files to the module's backups/ folder
const DBC_BACKUP_ROOT = path.resolve(__dirname, '..', 'backups');
const DBC_BACKUP_SOURCE_LABELS = ['base-dbc', 'export-dbc'];

function getDbcBackupSources(config) {
  return [
    { label: 'base-dbc', dir: path.join(PUBLIC_DIR, config.paths.base.dbc) },
    { label: 'export-dbc', dir: path.join(EXPORT_DIR, 'DBFilesClient') },
  ];
}

// Copies the current DBC sources into backups/<folderName>/{base-dbc,export-dbc}.
// Shared by the automatic once-per-day backup and the manual "Backup Now" endpoint.
function createDbcBackupSnapshot(folderName) {
  const destRootDir = path.join(DBC_BACKUP_ROOT, folderName);
  fs.mkdirSync(destRootDir, { recursive: true });

  const config = loadConfigFile();
  const sources = getDbcBackupSources(config);

  let totalCopied = 0;
  for (const src of sources) {
    if (!fs.existsSync(src.dir)) continue;

    const destDir = path.join(destRootDir, src.label);
    fs.mkdirSync(destDir, { recursive: true });

    const files = fs.readdirSync(src.dir).filter(f => f.endsWith('.dbc'));
    for (const file of files) {
      fs.copyFileSync(path.join(src.dir, file), path.join(destDir, file));
      totalCopied++;
    }
  }

  return { folderName, path: destRootDir, fileCount: totalCopied };
}

function todaysDbcBackupFolderName() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = now.getFullYear();
  return `${month}-${day}-${year}`;
}

function manualDbcBackupFolderName() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `manual-${month}-${day}-${year}_${hours}-${minutes}-${seconds}`;
}

// Lists every backup snapshot folder under backups/, newest first, with a
// per-snapshot DBC file count so the UI can show "last known backup".
function listDbcBackups() {
  if (!fs.existsSync(DBC_BACKUP_ROOT)) return [];

  return fs.readdirSync(DBC_BACKUP_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dirPath = path.join(DBC_BACKUP_ROOT, entry.name);
      const stat = fs.statSync(dirPath);
      let fileCount = 0;
      for (const label of DBC_BACKUP_SOURCE_LABELS) {
        const subDir = path.join(dirPath, label);
        if (fs.existsSync(subDir)) {
          fileCount += fs.readdirSync(subDir).filter((f) => f.endsWith('.dbc')).length;
        }
      }
      return {
        name: entry.name,
        manual: entry.name.startsWith('manual-'),
        mtime: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs,
        fileCount,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function performDailyBackup() {
  try {
    const dateLabel = todaysDbcBackupFolderName();
    const todayDir = path.join(DBC_BACKUP_ROOT, dateLabel);

    // If today's backup folder already exists, skip
    if (fs.existsSync(todayDir)) {
      console.log(`✓ Daily backup already exists for ${dateLabel}, skipping`);
      return;
    }

    const result = createDbcBackupSnapshot(dateLabel);
    console.log(`✓ Daily backup created: ${dateLabel} (${result.fileCount} DBC files)`);
  } catch (err) {
    console.error('Daily backup failed:', err);
    logErrorToFile(`Daily backup failed: ${err.stack || err}`);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓ Backend API running on http://0.0.0.0:${PORT}`);

  // Daily DBC backup (first start of the day only)
  performDailyBackup();

  // Build spell-icon index at startup (fast: loads from disk if cached, rebuilds if DBC changed)
  console.log('Loading spell-icon index...');
  try {
    loadOrBuildSpellIconIndex();
  } catch (err) {
    console.error('⚠ Spell-icon index build failed (non-fatal):', err.message);
    logErrorToFile(`Spell-icon index build failed: ${err.stack || err}`);
  }

  const config = loadConfigFile();
  const iconDir = getIconDirPath(config);
  const exportDbcPath = path.join(EXPORT_DIR, 'DBFilesClient', 'SpellIcon.dbc');
  const dbcPath = fs.existsSync(exportDbcPath)
    ? exportDbcPath
    : path.join(PUBLIC_DIR, getBaseDBCDir(config), 'SpellIcon.dbc');

  const iconList = loadIconListCache(iconDir);
  updateFullManifest(iconDir, dbcPath, { iconList, skipThumbnails: true })
    .then(() => console.log('✓ Icon manifest generated'))
    .catch(err => console.error('Manifest generation error:', err));

  // Generate sprite sheets for optimized loading
  console.log('Generating sprite sheets...');
  generateSpriteSheets().then(spriteResult => {
    console.log(`✓ Sprite sheets ready: ${spriteResult.sheets} sheets, ${spriteResult.icons} icons`);
  }).catch(err => {
    console.error('Sprite generation error:', err);
  });

  // Watch for icon list changes to update manifest incrementally
  startIconListWatcher(iconDir, dbcPath);
  console.log('Handles: DBC/icon copying, file checking, icon uploads');
  console.log('📋 Debug: Visit http://localhost:3001/api/debug/talent-trees to see talent tree mappings\n');
});

// Endpoint to receive frontend error logs (must be after app is defined)
function logFrontendError(fileName, req, res) {
  try {
    const ERROR_LOG_DIR = path.join(__dirname, 'public', 'error-logs');
    const ERROR_LOG_FILE = path.join(ERROR_LOG_DIR, fileName);
    if (!fs.existsSync(ERROR_LOG_DIR)) {
      fs.mkdirSync(ERROR_LOG_DIR, { recursive: true });
    }
    const error = req.body?.error || 'Unknown error';
    const timestamp = new Date().toISOString();
    fs.appendFileSync(ERROR_LOG_FILE, `[${timestamp}] ${error}\n`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to log frontend error' });
  }
}

app.post('/error-logs/frontend-errors.log', express.json(), (req, res) => {
  logFrontendError('frontend-errors.log', req, res);
});

app.post('/error-logs/spell-icon-errors.log', express.json(), (req, res) => {
  logFrontendError('spell-icon-errors.log', req, res);
});

app.post('/error-logs/talent-icon-errors.log', express.json(), (req, res) => {
  logFrontendError('talent-icon-errors.log', req, res);
});

// SPA catch-all: serve dist/index.html for any non-API route
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Frontend not built. Run: npx vite build' });
  }
});