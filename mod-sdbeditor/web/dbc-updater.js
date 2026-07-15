import fs from 'fs';
import path from 'path';

function normalizeIconName(input) {
  if (!input) return '';
  let name = String(input).replace(/\\/g, '/');
  if (name.includes('/')) name = name.substring(name.lastIndexOf('/') + 1);
  name = name.toLowerCase();
  name = name.replace(/\.blp$/i, '');
  return name.trim();
}

function buildDbcIconPath(baseName) {
  return `Interface\\Icons\\${baseName}`;
}

function readDbcString(buffer, stringBlockOffset, offset) {
  if (!offset) return '';
  const start = stringBlockOffset + offset;
  let end = start;
  while (end < buffer.length && buffer[end] !== 0) end++;
  return buffer.slice(start, end).toString('utf8');
}

/**
 * Update SpellIcon.dbc with new icon entries
 * Assigns next available ID and updates file path mappings
 */
export function addIconToSpellIconDbc(dbcPath, iconFilename) {
  try {
    if (!fs.existsSync(dbcPath)) {
      console.warn(`DBC file not found: ${dbcPath}`);
      return null;
    }

    const normalizedName = normalizeIconName(iconFilename);
    if (!normalizedName) {
      console.warn('Invalid icon filename');
      return null;
    }

    const buffer = fs.readFileSync(dbcPath);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let offset = 0;

    // Read header
    const signature = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    offset += 4;

    if (signature !== 'WDBC') {
      console.warn('Invalid DBC signature');
      return null;
    }

    const recordCount = view.getUint32(offset, true);
    offset += 4;
    const fieldCount = view.getUint32(offset, true);
    offset += 4;
    const fieldSize = view.getUint32(offset, true);
    offset += 4;
    const stringBlockSizeOld = view.getUint32(offset, true);
    offset += 4;

    // Find highest ID currently in DBC
    const recordsStart = offset;
    const stringBlockStart = recordsStart + recordCount * fieldSize;
    let maxId = -1;
    const existing = new Map();

    for (let i = 0; i < recordCount; i++) {
      const recordOffset = recordsStart + i * fieldSize;
      const id = view.getUint32(recordOffset, true);
      if (id > maxId) {
        maxId = id;
      }

      const nameOffset = view.getUint32(recordOffset + 4, true);
      const rawName = readDbcString(buffer, stringBlockStart, nameOffset);
      const key = normalizeIconName(rawName);
      if (key) existing.set(key, id);
    }

    if (existing.has(normalizedName)) {
      return {
        success: true,
        id: existing.get(normalizedName),
        filename: normalizedName,
        dbcPath,
        skipped: true,
      };
    }

    const newId = maxId + 1;

    // Read old string block
    const stringBlockOld = buffer.slice(stringBlockStart, stringBlockStart + stringBlockSizeOld);

    // Build new string block by appending after the existing null terminator
    const pathOffset = stringBlockOld.length;
    const newStringBytes = Buffer.from(`${buildDbcIconPath(normalizedName)}\0`, 'utf8');
    const newStringBlockSize = stringBlockOld.length + newStringBytes.length;

    // Create new DBC buffer
    const newRecordCount = recordCount + 1;
    const newFieldSize = fieldSize;
    const newHeaderSize = 20;
    const newRecordsSize = newRecordCount * newFieldSize;
    const newTotalSize = newHeaderSize + newRecordsSize + newStringBlockSize;

    const newBuffer = new Uint8Array(newTotalSize);
    const newView = new DataView(newBuffer.buffer);

    // Write header
    let writeOffset = 0;
    newBuffer[writeOffset++] = 87; // W
    newBuffer[writeOffset++] = 68; // D
    newBuffer[writeOffset++] = 66; // B
    newBuffer[writeOffset++] = 67; // C
    newView.setUint32(writeOffset, newRecordCount, true);
    writeOffset += 4;
    newView.setUint32(writeOffset, fieldCount, true);
    writeOffset += 4;
    newView.setUint32(writeOffset, newFieldSize, true);
    writeOffset += 4;
    newView.setUint32(writeOffset, newStringBlockSize, true);
    writeOffset += 4;

    // Copy old records
    const recordsSourceStart = recordsStart;
    const recordsDestStart = newHeaderSize;
    const oldRecordsBuffer = buffer.slice(recordsSourceStart, recordsSourceStart + recordCount * fieldSize);
    newBuffer.set(oldRecordsBuffer, recordsDestStart);

    // Add new record
    const newRecordStart = recordsDestStart + recordCount * fieldSize;
    const newRecordView = new DataView(newBuffer.buffer, newRecordStart, fieldSize);
    newRecordView.setUint32(0, newId, true); // field_0 = ID
    newRecordView.setUint32(4, pathOffset, true); // field_1 = string offset

    // Copy string block
    const stringBlockDest = recordsDestStart + newRecordsSize;
    newBuffer.set(stringBlockOld, stringBlockDest);
    newBuffer.set(newStringBytes, stringBlockDest + stringBlockOld.length);

    // Write updated DBC
    fs.writeFileSync(dbcPath, newBuffer);
    console.log(`✓ Added icon to DBC: "${normalizedName}" with ID ${newId}`);

    return {
      success: true,
      id: newId,
      filename: normalizedName,
      dbcPath
    };
  } catch (err) {
    console.error(`Error updating DBC: ${err.message}`);
    return null;
  }
}

/**
 * Batch update SpellIcon.dbc with multiple icons
 */
export function addIconsToDbc(dbcPath, iconFilenames) {
  const results = [];
  for (const filename of iconFilenames) {
    const result = addIconToSpellIconDbc(dbcPath, filename);
    if (result) {
      results.push(result);
    }
  }
  return results;
}

/**
 * Sync SpellIcon.dbc to include all missing icon names from a folder.
 * Writes output to the provided destination path (does not modify source).
 */
export function syncSpellIconDbcFromIcons(sourceDbcPath, iconDir, outputDbcPath, iconList = null) {
  try {
    if (!fs.existsSync(sourceDbcPath)) {
      return { success: false, error: `Source DBC not found: ${sourceDbcPath}` };
    }
    if (!fs.existsSync(iconDir)) {
      return { success: false, error: `Icon folder not found: ${iconDir}` };
    }

    const buffer = fs.readFileSync(sourceDbcPath);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let offset = 0;

    const signature = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    offset += 4;

    if (signature !== 'WDBC') {
      return { success: false, error: 'Invalid DBC signature' };
    }

    const recordCount = view.getUint32(offset, true);
    offset += 4;
    const fieldCount = view.getUint32(offset, true);
    offset += 4;
    const fieldSize = view.getUint32(offset, true);
    offset += 4;
    const stringBlockSizeOld = view.getUint32(offset, true);
    offset += 4;

    const recordsStart = offset;
    const stringBlockStart = recordsStart + recordCount * fieldSize;
    const stringBlockOld = buffer.slice(stringBlockStart, stringBlockStart + stringBlockSizeOld);

    let maxId = -1;
    const existing = new Set();
    for (let i = 0; i < recordCount; i++) {
      const recordOffset = recordsStart + i * fieldSize;
      const id = view.getUint32(recordOffset, true);
      if (id > maxId) maxId = id;
      const nameOffset = view.getUint32(recordOffset + 4, true);
      const rawName = readDbcString(buffer, stringBlockStart, nameOffset);
      const key = normalizeIconName(rawName);
      if (key) existing.add(key);
    }

    const iconFiles = Array.isArray(iconList)
      ? iconList
      : fs.readdirSync(iconDir).filter(f => f.toLowerCase().endsWith('.blp'));
    const missing = [];
    for (const file of iconFiles) {
      const key = normalizeIconName(file);
      if (!key || existing.has(key)) continue;
      existing.add(key);
      missing.push(key);
    }

    if (missing.length === 0) {
      if (outputDbcPath && outputDbcPath !== sourceDbcPath) {
        fs.mkdirSync(path.dirname(outputDbcPath), { recursive: true });
        fs.copyFileSync(sourceDbcPath, outputDbcPath);
      }
      return { success: true, added: 0, total: recordCount, output: outputDbcPath || sourceDbcPath };
    }

    missing.sort();

    const baseOffset = stringBlockOld.length;

    const appendedBuffers = [];
    const offsets = [];
    let runningOffset = baseOffset;
    for (const name of missing) {
      offsets.push(runningOffset);
      const buf = Buffer.from(buildDbcIconPath(name) + '\0', 'utf8');
      appendedBuffers.push(buf);
      runningOffset += buf.length;
    }

    const newStringBlockSize = runningOffset;
    const newRecordCount = recordCount + missing.length;
    const newHeaderSize = 20;
    const newRecordsSize = newRecordCount * fieldSize;
    const newTotalSize = newHeaderSize + newRecordsSize + newStringBlockSize;

    const newBuffer = Buffer.alloc(newTotalSize);
    const newView = new DataView(newBuffer.buffer);

    let writeOffset = 0;
    newBuffer[writeOffset++] = 87;
    newBuffer[writeOffset++] = 68;
    newBuffer[writeOffset++] = 66;
    newBuffer[writeOffset++] = 67;
    newView.setUint32(writeOffset, newRecordCount, true);
    writeOffset += 4;
    newView.setUint32(writeOffset, fieldCount, true);
    writeOffset += 4;
    newView.setUint32(writeOffset, fieldSize, true);
    writeOffset += 4;
    newView.setUint32(writeOffset, newStringBlockSize, true);
    writeOffset += 4;

    const recordsDestStart = newHeaderSize;
    newBuffer.set(buffer.slice(recordsStart, recordsStart + recordCount * fieldSize), recordsDestStart);

    let nextId = maxId + 1;
    for (let i = 0; i < missing.length; i++) {
      const newRecordStart = recordsDestStart + (recordCount + i) * fieldSize;
      const recView = new DataView(newBuffer.buffer, newRecordStart, fieldSize);
      recView.setUint32(0, nextId++, true);
      recView.setUint32(4, offsets[i], true);
    }

    const stringBlockDest = recordsDestStart + newRecordsSize;
    newBuffer.set(stringBlockOld, stringBlockDest);
    let stringWrite = stringBlockDest + baseOffset;
    for (const buf of appendedBuffers) {
      newBuffer.set(buf, stringWrite);
      stringWrite += buf.length;
    }

    fs.mkdirSync(path.dirname(outputDbcPath), { recursive: true });
    fs.writeFileSync(outputDbcPath, newBuffer);

    return {
      success: true,
      added: missing.length,
      total: newRecordCount,
      output: outputDbcPath,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Initialize SpellIcon.dbc if it doesn't exist
 */
export function initializeSpellIconDbc(dbcPath) {
  try {
    if (fs.existsSync(dbcPath)) {
      return { exists: true };
    }

    // Create minimal DBC: 2 fields (ID, iconPath)
    const fieldCount = 2;
    const recordCount = 0;
    const fieldSize = fieldCount * 4;
    const stringBlockSize = 1;
    const totalSize = 20 + recordCount * fieldSize + stringBlockSize;

    const buffer = new Uint8Array(totalSize);
    const view = new DataView(buffer.buffer);

    buffer[0] = 87; // W
    buffer[1] = 68; // D
    buffer[2] = 66; // B
    buffer[3] = 67; // C
    view.setUint32(4, fieldCount, true);
    view.setUint32(8, recordCount, true);
    view.setUint32(12, fieldSize, true);
    view.setUint32(16, stringBlockSize, true);
    buffer[20] = 0; // Null terminator for empty string block

    fs.writeFileSync(dbcPath, buffer);
    console.log(`✓ Created empty SpellIcon.dbc: ${dbcPath}`);
    return { created: true, path: dbcPath };
  } catch (err) {
    console.error(`Error initializing DBC: ${err.message}`);
    return null;
  }
}
