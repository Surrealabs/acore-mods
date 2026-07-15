/**
 * Generic DBC Parser & Writer for WoW 3.3.5a WDBC format
 * 
 * Reads any WDBC file and returns structured data.
 * Uses definitions from dbc-definitions.js when available,
 * falls back to generic Field_N naming.
 */

import fs from 'fs';
import path from 'path';
import { definitions, LOOKUP_SOURCES } from './dbc-definitions.js';

// ─── WDBC Header ────────────────────────────────────────────────────────
const HEADER_SIZE = 20;
const MAGIC = 'WDBC';

/**
 * Read a WDBC file and return structured data.
 * @param {string} filePath - absolute path to the .dbc file
 * @returns {{ header, definition, records, fieldDefs }}
 */
export function readDBC(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < HEADER_SIZE) {
    throw new Error('File too small to be a valid DBC');
  }

  const magic = buffer.toString('utf-8', 0, 4);
  if (magic !== MAGIC) {
    throw new Error(`Invalid magic: expected WDBC, got ${magic}`);
  }

  const header = {
    recordCount: buffer.readUInt32LE(4),
    fieldCount: buffer.readUInt32LE(8),
    recordSize: buffer.readUInt32LE(12),
    stringBlockSize: buffer.readUInt32LE(16),
  };

  const recordsStart = HEADER_SIZE;
  const stringBlockStart = recordsStart + (header.recordCount * header.recordSize);

  // Determine field definitions
  const baseName = path.basename(filePath, '.dbc');
  const def = definitions[baseName] || null;
  let fieldDefs;

  if (def && def.fields.length === header.fieldCount) {
    fieldDefs = def.fields;
  } else if (def && def.fields.length !== header.fieldCount) {
    // Definition exists but field count mismatch – use definition for as many
    // fields as possible, fill rest with generic names
    console.warn(`[DBC] ${baseName}: def has ${def.fields.length} fields but file has ${header.fieldCount}. Using partial definition.`);
    fieldDefs = [];
    for (let i = 0; i < header.fieldCount; i++) {
      if (i < def.fields.length) {
        fieldDefs.push(def.fields[i]);
      } else {
        fieldDefs.push({ name: `Field_${i}`, type: 'uint32' });
      }
    }
  } else {
    // No definition – generate generic field names
    fieldDefs = Array.from({ length: header.fieldCount }, (_, i) => ({
      name: `Field_${i}`,
      type: 'uint32',
    }));
  }

  // Helper to read a string from the string block
  function readString(offset) {
    if (offset === 0 || offset >= header.stringBlockSize) return '';
    const start = stringBlockStart + offset;
    let end = start;
    while (end < buffer.length && buffer[end] !== 0) end++;
    return buffer.toString('utf-8', start, end);
  }

  // Parse records
  const records = [];
  for (let i = 0; i < header.recordCount; i++) {
    const recOffset = recordsStart + (i * header.recordSize);
    const row = [];

    for (let f = 0; f < header.fieldCount; f++) {
      const fieldOffset = recOffset + (f * 4);
      const fieldDef = fieldDefs[f];

      switch (fieldDef.type) {
        case 'float': {
          row.push(buffer.readFloatLE(fieldOffset));
          break;
        }
        case 'int32': {
          row.push(buffer.readInt32LE(fieldOffset));
          break;
        }
        case 'string': {
          const strOffset = buffer.readUInt32LE(fieldOffset);
          row.push(readString(strOffset));
          break;
        }
        case 'flags': {
          row.push(buffer.readUInt32LE(fieldOffset));
          break;
        }
        default: { // uint32
          row.push(buffer.readUInt32LE(fieldOffset));
          break;
        }
      }
    }

    records.push(row);
  }

  return {
    header,
    definition: def,
    fieldDefs,
    records,
    baseName,
  };
}

/**
 * Write a WDBC file from structured data.
 * @param {string} filePath - absolute path to write
 * @param {{ fieldDefs, records, header }} data
 */
export function writeDBC(filePath, data) {
  const { fieldDefs, records, header } = data;
  const fieldCount = fieldDefs.length;
  const recordSize = fieldCount * 4;
  const recordCount = records.length;

  // Build string block - collect all strings and assign offsets
  const stringMap = new Map(); // string -> offset
  let stringBlock = Buffer.from([0]); // starts with null terminator at offset 0
  let nextStringOffset = 1;

  // Empty string always maps to offset 0
  stringMap.set('', 0);

  // First pass: collect all unique strings
  for (const row of records) {
    for (let f = 0; f < fieldCount; f++) {
      if (fieldDefs[f].type === 'string') {
        const str = String(row[f] ?? '');
        if (str !== '' && !stringMap.has(str)) {
          stringMap.set(str, nextStringOffset);
          const strBuf = Buffer.from(str + '\0', 'utf-8');
          stringBlock = Buffer.concat([stringBlock, strBuf]);
          nextStringOffset += strBuf.length;
        }
      }
    }
  }

  const stringBlockSize = stringBlock.length;
  const totalSize = HEADER_SIZE + (recordCount * recordSize) + stringBlockSize;
  const buffer = Buffer.alloc(totalSize);

  // Write header
  buffer.write(MAGIC, 0, 4, 'utf-8');
  buffer.writeUInt32LE(recordCount, 4);
  buffer.writeUInt32LE(fieldCount, 8);
  buffer.writeUInt32LE(recordSize, 12);
  buffer.writeUInt32LE(stringBlockSize, 16);

  // Write records
  for (let i = 0; i < recordCount; i++) {
    const recOffset = HEADER_SIZE + (i * recordSize);
    const row = records[i];

    for (let f = 0; f < fieldCount; f++) {
      const fieldOffset = recOffset + (f * 4);
      const fieldDef = fieldDefs[f];
      const val = row[f];

      switch (fieldDef.type) {
        case 'float': {
          buffer.writeFloatLE(Number(val) || 0, fieldOffset);
          break;
        }
        case 'int32': {
          buffer.writeInt32LE(Number(val) || 0, fieldOffset);
          break;
        }
        case 'string': {
          const str = String(val ?? '');
          const offset = stringMap.get(str) ?? 0;
          buffer.writeUInt32LE(offset, fieldOffset);
          break;
        }
        default: { // uint32, flags
          buffer.writeUInt32LE(Number(val) >>> 0, fieldOffset);
          break;
        }
      }
    }
  }

  // Write string block
  stringBlock.copy(buffer, HEADER_SIZE + (recordCount * recordSize));

  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, buffer);
  return { recordCount, fieldCount, recordSize, stringBlockSize };
}

/**
 * Build lookup tables for foreign-key references.
 * Given a set of ref names, reads the corresponding DBC files
 * and returns { refName: { id: displayName, ... } }
 */
export function buildLookups(refNames, dbcDir) {
  const lookups = {};

  for (const refName of refNames) {
    const source = LOOKUP_SOURCES[refName];
    if (!source) continue;

    const filePath = path.join(dbcDir, source.file);
    if (!fs.existsSync(filePath)) continue;

    try {
      const { records, fieldDefs } = readDBC(filePath);
      const lookup = {};
      const nameIdx = source.nameFieldIndex;

      for (const row of records) {
        const id = row[0]; // ID is always field 0
        const name = nameIdx < row.length ? row[nameIdx] : '';
        if (name) {
          lookup[id] = String(name);
        }
      }

      lookups[refName] = lookup;
    } catch (err) {
      console.error(`[DBC] Failed to build lookup for ${refName}:`, err.message);
    }
  }

  return lookups;
}

/**
 * Compare records between two DBC files (e.g. base vs custom).
 * Returns array of { recordIndex, fieldIndex, baseValue, customValue }
 */
export function diffDBC(basePath, customPath) {
  if (!fs.existsSync(basePath) || !fs.existsSync(customPath)) {
    return { error: 'One or both files not found' };
  }

  const base = readDBC(basePath);
  const custom = readDBC(customPath);

  // Build ID-indexed maps for comparison
  const baseMap = new Map();
  for (let i = 0; i < base.records.length; i++) {
    baseMap.set(base.records[i][0], { index: i, row: base.records[i] });
  }

  const customMap = new Map();
  for (let i = 0; i < custom.records.length; i++) {
    customMap.set(custom.records[i][0], { index: i, row: custom.records[i] });
  }

  const changes = [];
  const added = [];
  const removed = [];

  // Find modified and added records
  for (const [id, customEntry] of customMap) {
    const baseEntry = baseMap.get(id);
    if (!baseEntry) {
      added.push({ id, record: customEntry.row });
      continue;
    }

    // Compare field by field
    const fieldChanges = [];
    for (let f = 0; f < Math.max(baseEntry.row.length, customEntry.row.length); f++) {
      const baseVal = f < baseEntry.row.length ? baseEntry.row[f] : undefined;
      const custVal = f < customEntry.row.length ? customEntry.row[f] : undefined;
      if (baseVal !== custVal) {
        fieldChanges.push({
          fieldIndex: f,
          fieldName: custom.fieldDefs[f]?.name || `Field_${f}`,
          baseValue: baseVal,
          customValue: custVal,
        });
      }
    }

    if (fieldChanges.length > 0) {
      changes.push({ id, fields: fieldChanges });
    }
  }

  // Find removed records
  for (const [id] of baseMap) {
    if (!customMap.has(id)) {
      removed.push({ id, record: baseMap.get(id).row });
    }
  }

  return {
    summary: {
      totalBase: base.records.length,
      totalCustom: custom.records.length,
      modified: changes.length,
      added: added.length,
      removed: removed.length,
    },
    changes,
    added,
    removed,
  };
}
