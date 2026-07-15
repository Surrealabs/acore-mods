/**
 * Generic DBC API Router
 * 
 * Express router providing REST endpoints for reading, writing,
 * comparing, and exporting any WDBC file.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readDBC, writeDBC, buildLookups, diffDBC } from './generic-dbc-parser.js';
import { definitions } from './dbc-definitions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const EXPORT_DBC_DIR = path.join(__dirname, '..', 'export', 'DBFilesClient');

function loadConfig() {
  const configPath = path.join(PUBLIC_DIR, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch { /* ignore */ }
  return {
    paths: {
      base: { dbc: 'dbc' },
      custom: { dbc: 'custom-dbc' },
    },
  };
}

const router = express.Router();

// ─── GET /api/dbc/list ──────────────────────────────────────────────────
// List all available DBC files from both base and custom directories
router.get('/list', (req, res) => {
  try {
    const config = loadConfig();
    const baseDir = path.join(PUBLIC_DIR, config.paths.base.dbc);
    const exportDir = EXPORT_DBC_DIR;

    const baseFiles = fs.existsSync(baseDir)
      ? fs.readdirSync(baseDir).filter(f => f.endsWith('.dbc'))
      : [];
    const exportFiles = fs.existsSync(exportDir)
      ? fs.readdirSync(exportDir).filter(f => f.endsWith('.dbc'))
      : [];

    // Merge: all unique filenames with source info
    const allFiles = new Map();
    for (const f of baseFiles) {
      const name = path.basename(f, '.dbc');
      allFiles.set(f, {
        filename: f,
        name,
        hasBase: true,
        hasExport: false,
        hasDefinition: !!definitions[name],
        fieldCount: null,
        recordCount: null,
      });
    }
    for (const f of exportFiles) {
      const name = path.basename(f, '.dbc');
      if (allFiles.has(f)) {
        allFiles.get(f).hasExport = true;
      } else {
        allFiles.set(f, {
          filename: f,
          name,
          hasBase: false,
          hasExport: true,
          hasDefinition: !!definitions[name],
          fieldCount: null,
          recordCount: null,
        });
      }
    }

    // Read header info for each file (fast – only 20 bytes)
    for (const [filename, info] of allFiles) {
      const dir = info.hasExport ? exportDir : baseDir;
      const fp = path.join(dir, filename);
      try {
        const fd = fs.openSync(fp, 'r');
        const hdr = Buffer.alloc(20);
        fs.readSync(fd, hdr, 0, 20, 0);
        fs.closeSync(fd);
        if (hdr.toString('utf-8', 0, 4) === 'WDBC') {
          info.recordCount = hdr.readUInt32LE(4);
          info.fieldCount = hdr.readUInt32LE(8);
        }
      } catch { /* ignore */ }
    }

    const result = Array.from(allFiles.values())
      .sort((a, b) => a.filename.localeCompare(b.filename));

    res.json({ files: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/dbc/definitions ───────────────────────────────────────────
// Return all available definitions (for client-side reference)
router.get('/definitions', (req, res) => {
  const defSummary = {};
  for (const [name, def] of Object.entries(definitions)) {
    defSummary[name] = {
      name: def.name,
      fieldCount: def.fields.length,
      fields: def.fields.map(f => ({
        name: f.name,
        type: f.type,
        ref: f.ref || null,
        hidden: f.hidden || false,
      })),
    };
  }
  res.json(defSummary);
});

// ─── GET /api/dbc/read/:filename ────────────────────────────────────────
// Read an entire DBC file and return structured JSON
router.get('/read/:filename', (req, res) => {
  try {
    const config = loadConfig();
    const filename = req.params.filename;
    const source = req.query.source || 'auto'; // 'base', 'export', 'custom', or 'auto'

    if (!filename.endsWith('.dbc')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    let filePath;
    if (source === 'base') {
      filePath = path.join(PUBLIC_DIR, config.paths.base.dbc, filename);
    } else if (source === 'export' || source === 'custom') {
      filePath = path.join(EXPORT_DBC_DIR, filename);
    } else {
      // Auto: prefer export, fallback to base
      const exportPath = path.join(EXPORT_DBC_DIR, filename);
      const basePath = path.join(PUBLIC_DIR, config.paths.base.dbc, filename);
      filePath = fs.existsSync(exportPath) ? exportPath : basePath;
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `File not found: ${filename}` });
    }

    const data = readDBC(filePath);

    // Collect referenced lookup names
    const refNames = new Set();
    for (const fd of data.fieldDefs) {
      if (fd.ref) refNames.add(fd.ref);
    }

    // Build lookups from whichever DBC dir has the files
    let lookups = {};
    if (refNames.size > 0) {
      const baseDir = path.join(PUBLIC_DIR, config.paths.base.dbc);
      const exportDir = EXPORT_DBC_DIR;
      // Try export first, then base
      lookups = buildLookups(refNames, fs.existsSync(exportDir) ? exportDir : baseDir);
      // Fill from base if export didn't have everything
      if (fs.existsSync(baseDir)) {
        const baseLookups = buildLookups(refNames, baseDir);
        for (const [key, val] of Object.entries(baseLookups)) {
          if (!lookups[key]) lookups[key] = val;
        }
      }
    }

    res.json({
      filename,
      source: filePath.includes(EXPORT_DBC_DIR) ? 'export' : 'base',
      header: data.header,
      fieldDefs: data.fieldDefs.map(fd => ({
        name: fd.name,
        type: fd.type,
        ref: fd.ref || null,
        hidden: fd.hidden || false,
        locale: fd.locale || null,
      })),
      records: data.records,
      lookups,
      hasDefinition: !!data.definition,
    });
  } catch (err) {
    console.error('[DBC Read Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/dbc/save/:filename ───────────────────────────────────────
// Save modified records to the custom DBC directory
router.post('/save/:filename', express.json({ limit: '100mb' }), (req, res) => {
  try {
    const config = loadConfig();
    const filename = req.params.filename;
    const { records, fieldDefs } = req.body;

    if (!filename.endsWith('.dbc')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    if (!records || !fieldDefs) {
      return res.status(400).json({ error: 'Missing records or fieldDefs' });
    }

    const exportDir = EXPORT_DBC_DIR;
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    const filePath = path.join(exportDir, filename);

    // Create backup
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, filePath + '.bak');
    }

    const result = writeDBC(filePath, { fieldDefs, records, header: {} });

    res.json({
      success: true,
      filename,
      ...result,
    });
  } catch (err) {
    console.error('[DBC Save Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/dbc/copy-to-custom/:filename ─────────────────────────────
// Copy a base DBC to the export directory for editing
router.post('/copy-to-custom/:filename', (req, res) => {
  try {
    const config = loadConfig();
    const filename = req.params.filename;
    const basePath = path.join(PUBLIC_DIR, config.paths.base.dbc, filename);
    const exportDir = EXPORT_DBC_DIR;
    const exportPath = path.join(exportDir, filename);

    if (!fs.existsSync(basePath)) {
      return res.status(404).json({ error: 'Base file not found' });
    }

    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    fs.copyFileSync(basePath, exportPath);
    res.json({ success: true, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/dbc/diff/:filename ────────────────────────────────────────
// Compare base vs custom DBC and return differences
router.get('/diff/:filename', (req, res) => {
  try {
    const config = loadConfig();
    const filename = req.params.filename;
    const basePath = path.join(PUBLIC_DIR, config.paths.base.dbc, filename);
    const exportPath = path.join(EXPORT_DBC_DIR, filename);

    if (!fs.existsSync(basePath)) {
      return res.status(404).json({ error: 'Base file not found for comparison' });
    }
    if (!fs.existsSync(exportPath)) {
      return res.status(404).json({ error: 'Export file not found for comparison' });
    }

    const result = diffDBC(basePath, exportPath);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/dbc/export-csv/:filename ──────────────────────────────────
// Export DBC as CSV
router.get('/export-csv/:filename', (req, res) => {
  try {
    const config = loadConfig();
    const filename = req.params.filename;
    const source = req.query.source || 'auto';

    let filePath;
    if (source === 'export' || source === 'custom') {
      filePath = path.join(EXPORT_DBC_DIR, filename);
    } else if (source === 'base') {
      filePath = path.join(PUBLIC_DIR, config.paths.base.dbc, filename);
    } else {
      const customPath = path.join(EXPORT_DBC_DIR, filename);
      const basePath = path.join(PUBLIC_DIR, config.paths.base.dbc, filename);
      filePath = fs.existsSync(customPath) ? customPath : basePath;
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const data = readDBC(filePath);

    // Build CSV
    const headers = data.fieldDefs.map(fd => fd.name);
    const csvRows = [headers.join(',')];

    for (const row of data.records) {
      const csvRow = row.map(val => {
        if (typeof val === 'string') {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return String(val);
      });
      csvRows.push(csvRow.join(','));
    }

    const csvContent = csvRows.join('\n');
    const baseName = path.basename(filename, '.dbc');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/dbc/import-csv/:filename ─────────────────────────────────
// Import CSV data and save as DBC
router.post('/import-csv/:filename', express.text({ limit: '100mb' }), (req, res) => {
  try {
    const config = loadConfig();
    const filename = req.params.filename;
    const csvText = req.body;

    if (!filename.endsWith('.dbc')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    // Parse CSV (simple parser, handles quoted strings)
    const lines = csvText.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV must have header + at least 1 data row' });
    }

    const headerLine = lines[0];
    const fieldNames = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));

    // Try to match field names to a definition
    const baseName = path.basename(filename, '.dbc');
    const def = definitions[baseName];
    let fieldDefs;

    if (def && def.fields.length === fieldNames.length) {
      fieldDefs = def.fields;
    } else {
      // Infer types: try to detect strings, floats, ints
      fieldDefs = fieldNames.map(name => ({ name, type: 'uint32' }));
    }

    // Parse data rows
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVRow(lines[i]);
      const parsed = [];
      for (let f = 0; f < row.length && f < fieldDefs.length; f++) {
        const typ = fieldDefs[f].type;
        if (typ === 'string') {
          parsed.push(row[f]);
        } else if (typ === 'float') {
          parsed.push(parseFloat(row[f]) || 0);
        } else if (typ === 'int32') {
          parsed.push(parseInt(row[f]) || 0);
        } else {
          parsed.push(parseInt(row[f]) || 0);
        }
      }
      records.push(parsed);
    }

    // Save
    const exportDir = EXPORT_DBC_DIR;
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }
    const filePath = path.join(exportDir, filename);
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, filePath + '.bak');
    }

    const result = writeDBC(filePath, { fieldDefs, records, header: {} });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simple CSV row parser that handles quoted fields
function parseCSVRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

// ─── GET /api/dbc/lookup/:refName ───────────────────────────────────────
// Get a specific lookup table
router.get('/lookup/:refName', (req, res) => {
  try {
    const config = loadConfig();
    const refName = req.params.refName;
    const baseDir = path.join(PUBLIC_DIR, config.paths.base.dbc);
    const exportDir = EXPORT_DBC_DIR;

    let lookups = {};
    if (fs.existsSync(exportDir)) {
      lookups = buildLookups([refName], exportDir);
    }
    if (!lookups[refName] && fs.existsSync(baseDir)) {
      lookups = buildLookups([refName], baseDir);
    }

    res.json(lookups[refName] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/dbc/talent-layout/save ───────────────────────────────
// Save the TALENT_LAYOUTS block into SurrealTalentFrame_AIO.lua
router.post('/talent-layout/save', (req, res) => {
  try {
    const { lua } = req.body;
    if (!lua || typeof lua !== 'string') {
      return res.status(400).json({ error: 'Missing "lua" string in request body' });
    }

    // Locate the Lua script file
    const luaPath = path.resolve(__dirname, '../../../lua_scripts/SurrealTalentFrame_AIO.lua');
    // Also check common alternative paths
    const altPath = path.resolve('/root/lua_scripts/SurrealTalentFrame_AIO.lua');
    const targetPath = fs.existsSync(luaPath) ? luaPath : fs.existsSync(altPath) ? altPath : null;

    if (!targetPath) {
      return res.status(404).json({ error: 'SurrealTalentFrame_AIO.lua not found' });
    }

    let content = fs.readFileSync(targetPath, 'utf8');

    // Find the TALENT_LAYOUTS block — from "local TALENT_LAYOUTS = {" to the matching closing "}"
    const startMarker = '    local TALENT_LAYOUTS = {';
    const startIdx = content.indexOf(startMarker);
    if (startIdx === -1) {
      return res.status(400).json({ error: 'Could not find TALENT_LAYOUTS in Lua file' });
    }

    // Find the end: track brace depth from the opening {
    let braceDepth = 0;
    let endIdx = -1;
    for (let i = startIdx + startMarker.length - 1; i < content.length; i++) {
      if (content[i] === '{') braceDepth++;
      if (content[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }

    if (endIdx === -1) {
      return res.status(400).json({ error: 'Could not find end of TALENT_LAYOUTS block' });
    }

    // Backup
    const backupPath = targetPath + '.layout-backup';
    fs.writeFileSync(backupPath, content, 'utf8');

    // Replace the block
    content = content.substring(0, startIdx) + lua + content.substring(endIdx);
    fs.writeFileSync(targetPath, content, 'utf8');

    res.json({ message: `Saved to ${path.basename(targetPath)} (backup: ${path.basename(backupPath)})` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/dbc/talent-layout/read ────────────────────────────────
// Read the current TALENT_LAYOUTS block from the Lua file
router.get('/talent-layout/read', (req, res) => {
  try {
    const luaPath = path.resolve(__dirname, '../../../lua_scripts/SurrealTalentFrame_AIO.lua');
    const altPath = path.resolve('/root/lua_scripts/SurrealTalentFrame_AIO.lua');
    const targetPath = fs.existsSync(luaPath) ? luaPath : fs.existsSync(altPath) ? altPath : null;

    if (!targetPath) {
      return res.status(404).json({ error: 'SurrealTalentFrame_AIO.lua not found' });
    }

    const content = fs.readFileSync(targetPath, 'utf8');
    const startMarker = '    local TALENT_LAYOUTS = {';
    const startIdx = content.indexOf(startMarker);
    if (startIdx === -1) {
      return res.json({ lua: '' });
    }

    let braceDepth = 0;
    let endIdx = -1;
    for (let i = startIdx + startMarker.length - 1; i < content.length; i++) {
      if (content[i] === '{') braceDepth++;
      if (content[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }

    const lua = endIdx > -1 ? content.substring(startIdx, endIdx) : '';
    res.json({ lua });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
