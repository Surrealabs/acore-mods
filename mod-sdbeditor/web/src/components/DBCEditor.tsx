import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ──────────────────────────────────────────────────────────────────
 *  Types
 * ────────────────────────────────────────────────────────────────── */

interface FieldDef {
  name: string;
  type: 'uint32' | 'int32' | 'float' | 'string' | 'flags';
  ref?: string | null;
  hidden?: boolean;
  locale?: string | null;
}

interface DBCFileInfo {
  filename: string;
  name: string;
  hasBase: boolean;
  hasExport: boolean;
  hasDefinition: boolean;
  fieldCount: number | null;
  recordCount: number | null;
}

interface DBCData {
  filename: string;
  source: 'base' | 'export';
  header: { recordCount: number; fieldCount: number; recordSize: number; stringBlockSize: number };
  fieldDefs: FieldDef[];
  records: (string | number)[][];
  lookups: Record<string, Record<string, string>>;
  hasDefinition: boolean;
}

interface DiffResult {
  summary: { totalBase: number; totalCustom: number; modified: number; added: number; removed: number };
  changes: { id: number; fields: { fieldIndex: number; fieldName: string; baseValue: unknown; customValue: unknown }[] }[];
  added: { id: number; record: unknown[] }[];
  removed: { id: number; record: unknown[] }[];
}

interface BatchOp {
  column: number;
  findValue: string;
  replaceValue: string;
  matchType: 'exact' | 'contains';
}

/* ──────────────────────────────────────────────────────────────────
 *  Shared style constants
 * ────────────────────────────────────────────────────────────────── */

const COLORS = {
  bg: '#0d1117',
  bgLight: '#161b22',
  bgHover: '#1c2333',
  border: '#30363d',
  text: '#c9d1d9',
  textDim: '#8b949e',
  textBright: '#f0f6fc',
  accent: '#58a6ff',
  accentHover: '#79c0ff',
  green: '#3fb950',
  red: '#f85149',
  orange: '#d29922',
  yellow: '#e3b341',
  purple: '#bc8cff',
  cellEdit: '#1a2332',
  modified: '#2d1f00',
};

/* ──────────────────────────────────────────────────────────────────
 *  WoW Enums for human-readable display
 * ────────────────────────────────────────────────────────────────── */

const RACE_NAMES: Record<number, string> = {
  1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf', 5: 'Undead',
  6: 'Tauren', 7: 'Gnome', 8: 'Troll', 10: 'Blood Elf', 11: 'Draenei',
};

const CLASS_NAMES: Record<number, string> = {
  1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest',
  6: 'Death Knight', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 11: 'Druid',
};

const SEX_NAMES: Record<number, string> = { 0: 'Male', 1: 'Female' };

const INVENTORY_TYPES: Record<number, string> = {
  0: 'None', 1: 'Head', 2: 'Neck', 3: 'Shoulder', 4: 'Body (Shirt)',
  5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrists',
  10: 'Hands', 11: 'Finger', 12: 'Trinket', 13: 'One-Hand', 14: 'Shield',
  15: 'Ranged (Bow)', 16: 'Back', 17: 'Two-Hand', 18: 'Bag',
  19: 'Tabard', 20: 'Robe', 21: 'Main Hand', 22: 'Off Hand',
  23: 'Holdable', 24: 'Ammo', 25: 'Thrown', 26: 'Ranged (Gun/Wand)',
  28: 'Relic',
};

/* ──────────────────────────────────────────────────────────────────
 *  Main Component
 * ────────────────────────────────────────────────────────────────── */

interface Props {
  textColor: string;
  contentBoxColor: string;
}

export default function DBCEditor({ textColor: _tc, contentBoxColor: _cbc }: Props) {
  // File list
  const [files, setFiles] = useState<DBCFileInfo[]>([]);
  const [fileFilter, setFileFilter] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // DBC data
  const [data, setData] = useState<DBCData | null>(null);
  const [editedRecords, setEditedRecords] = useState<Map<number, (string | number)[]>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Table state
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [columnFilters, setColumnFilters] = useState<Record<number, string>>({});
  const [globalSearch, setGlobalSearch] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Batch edit
  const [showBatch, setShowBatch] = useState(false);
  const [batchOp, setBatchOp] = useState<BatchOp>({ column: 0, findValue: '', replaceValue: '', matchType: 'exact' });
  const [batchResult, setBatchResult] = useState<string | null>(null);

  // Diff
  const [showDiff, setShowDiff] = useState(false);
  const [diffData, setDiffData] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // Selected rows for batch operations
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  // ─── Load file list ──────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/dbc/list')
      .then(r => r.json())
      .then(d => setFiles(d.files || []))
      .catch(err => console.error('Failed to load DBC list:', err));
  }, []);

  // ─── Load DBC file ───────────────────────────────────────────────
  const loadFile = useCallback(async (filename: string) => {
    setLoading(true);
    setData(null);
    setEditedRecords(new Map());
    setPage(0);
    setSortCol(null);
    setColumnFilters({});
    setGlobalSearch('');
    setSelectedRows(new Set());
    setShowDiff(false);
    setDiffData(null);
    setSaveMsg(null);
    setSelectedFile(filename);

    try {
      const res = await fetch(`/api/dbc/read/${filename}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
    } catch (err: unknown) {
      console.error('Failed to load DBC:', err);
      setSaveMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Visible columns ────────────────────────────────────────────
  const visibleColumns = useMemo(() => {
    if (!data) return [];
    return data.fieldDefs
      .map((fd, i) => ({ ...fd, index: i }))
      .filter(fd => showHidden || !fd.hidden);
  }, [data, showHidden]);

  // ─── Working records (with edits applied) ────────────────────────
  const workingRecords = useMemo(() => {
    if (!data) return [];
    return data.records.map((row, i) => {
      const edited = editedRecords.get(i);
      return edited || row;
    });
  }, [data, editedRecords]);

  // ─── Filtered & sorted records ───────────────────────────────────
  const processedRecords = useMemo(() => {
    let recs = workingRecords.map((row, origIdx) => ({ row, origIdx }));

    // Global search
    if (globalSearch) {
      const lower = globalSearch.toLowerCase();
      recs = recs.filter(({ row }) =>
        row.some(v => String(v).toLowerCase().includes(lower))
      );
    }

    // Column filters
    for (const [colStr, filterVal] of Object.entries(columnFilters)) {
      if (!filterVal) continue;
      const col = Number(colStr);
      const lower = filterVal.toLowerCase();
      recs = recs.filter(({ row }) =>
        String(row[col] ?? '').toLowerCase().includes(lower)
      );
    }

    // Sort
    if (sortCol !== null) {
      recs.sort((a, b) => {
        const va = a.row[sortCol];
        const vb = b.row[sortCol];
        if (typeof va === 'number' && typeof vb === 'number') {
          return sortDir === 'asc' ? va - vb : vb - va;
        }
        const sa = String(va ?? '');
        const sb = String(vb ?? '');
        return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
      });
    }

    return recs;
  }, [workingRecords, globalSearch, columnFilters, sortCol, sortDir]);

  // ─── Pagination ──────────────────────────────────────────────────
  const totalPages = Math.ceil(processedRecords.length / pageSize);
  const pageRecords = processedRecords.slice(page * pageSize, (page + 1) * pageSize);

  // ─── Cell editing ────────────────────────────────────────────────
  const startEdit = (origIdx: number, col: number) => {
    const row = editedRecords.get(origIdx) || data!.records[origIdx];
    setEditingCell({ row: origIdx, col });
    setEditingValue(String(row[col] ?? ''));
    setTimeout(() => editInputRef.current?.select(), 0);
  };

  const commitEdit = () => {
    if (!editingCell || !data) return;
    const { row: origIdx, col } = editingCell;
    const currentRow = [...(editedRecords.get(origIdx) || data.records[origIdx])];
    const fieldDef = data.fieldDefs[col];

    let newVal: string | number;
    if (fieldDef.type === 'string') {
      newVal = editingValue;
    } else if (fieldDef.type === 'float') {
      newVal = parseFloat(editingValue) || 0;
    } else if (fieldDef.type === 'int32') {
      newVal = parseInt(editingValue) || 0;
    } else {
      // uint32 / flags
      if (editingValue.startsWith('0x') || editingValue.startsWith('0X')) {
        newVal = parseInt(editingValue, 16) >>> 0;
      } else {
        newVal = (parseInt(editingValue) || 0) >>> 0;
      }
    }

    currentRow[col] = newVal;
    setEditedRecords(new Map(editedRecords).set(origIdx, currentRow));
    setEditingCell(null);
  };

  const cancelEdit = () => {
    setEditingCell(null);
  };

  // ─── Save ────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!data || editedRecords.size === 0) return;
    setSaving(true);
    setSaveMsg(null);

    try {
      // Merge edits into full records array
      const allRecords = data.records.map((row, i) => editedRecords.get(i) || row);

      const res = await fetch(`/api/dbc/save/${data.filename}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: allRecords,
          fieldDefs: data.fieldDefs,
        }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      setSaveMsg(`Saved ${result.recordCount} records to export/DBFilesClient/${data.filename}`);
      // Reload to get fresh data
      await loadFile(data.filename);
    } catch (err: unknown) {
      setSaveMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  // ─── Copy to export ─────────────────────────────────────────────
  const handleCopyToCustom = async () => {
    if (!data) return;
    try {
      const res = await fetch(`/api/dbc/copy-to-custom/${data.filename}`, { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setSaveMsg(`Copied ${data.filename} to export/DBFilesClient/`);
      await loadFile(data.filename);
    } catch (err: unknown) {
      setSaveMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // ─── Export CSV ──────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (!data) return;
    window.open(`/api/dbc/export-csv/${data.filename}`, '_blank');
  };

  // ─── Diff ────────────────────────────────────────────────────────
  const handleDiff = async () => {
    if (!data) return;
    setDiffLoading(true);
    try {
      const res = await fetch(`/api/dbc/diff/${data.filename}`);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setDiffData(result);
      setShowDiff(true);
    } catch (err: unknown) {
      setSaveMsg(`Diff error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDiffLoading(false);
    }
  };

  // ─── Batch Edit ──────────────────────────────────────────────────
  const executeBatch = () => {
    if (!data) return;
    const { column, findValue, replaceValue, matchType } = batchOp;
    if (!findValue && matchType === 'exact') {
      setBatchResult('Find value cannot be empty for exact match');
      return;
    }

    let count = 0;
    const newEdits = new Map(editedRecords);
    const targetRows = selectedRows.size > 0 ? Array.from(selectedRows) : workingRecords.map((_, i) => i);

    for (const origIdx of targetRows) {
      const row = [...(newEdits.get(origIdx) || data.records[origIdx])];
      const val = String(row[column] ?? '');

      let match = false;
      if (matchType === 'exact') {
        match = val === findValue;
      } else {
        match = val.toLowerCase().includes(findValue.toLowerCase());
      }

      if (match) {
        const fieldDef = data.fieldDefs[column];
        let newVal: string | number;
        if (fieldDef.type === 'string') {
          newVal = matchType === 'contains'
            ? val.replace(new RegExp(findValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replaceValue)
            : replaceValue;
        } else if (fieldDef.type === 'float') {
          newVal = parseFloat(replaceValue) || 0;
        } else if (fieldDef.type === 'int32') {
          newVal = parseInt(replaceValue) || 0;
        } else {
          newVal = (parseInt(replaceValue) || 0) >>> 0;
        }

        row[column] = newVal;
        newEdits.set(origIdx, row);
        count++;
      }
    }

    setEditedRecords(newEdits);
    setBatchResult(`Replaced ${count} value(s) in column "${data.fieldDefs[column].name}"`);
  };

  // ─── Add row ─────────────────────────────────────────────────────
  const handleAddRow = () => {
    if (!data) return;
    // Create a new row with default values
    const newRow = data.fieldDefs.map((fd, i) => {
      if (fd.type === 'string') return '';
      if (i === 0) {
        // Auto-increment ID
        const maxId = Math.max(0, ...workingRecords.map(r => Number(r[0]) || 0));
        return maxId + 1;
      }
      return 0;
    });

    const newRecords = [...data.records, newRow];
    setData({ ...data, records: newRecords, header: { ...data.header, recordCount: newRecords.length } });
    // Mark it as edited so it gets included in save
    setEditedRecords(new Map(editedRecords).set(newRecords.length - 1, newRow));
    // Jump to last page
    setPage(Math.floor(newRecords.length / pageSize));
    setSaveMsg('New row added (unsaved)');
  };

  // ─── Delete selected rows ───────────────────────────────────────
  const handleDeleteSelected = () => {
    if (!data || selectedRows.size === 0) return;
    const keepIndices = data.records.map((_, i) => i).filter(i => !selectedRows.has(i));
    const newRecords = keepIndices.map(i => editedRecords.get(i) || data.records[i]);

    // Rebuild edits map (indices shifted)
    const newEdits = new Map<number, (string | number)[]>();
    setEditedRecords(newEdits);
    setData({ ...data, records: newRecords, header: { ...data.header, recordCount: newRecords.length } });
    setSelectedRows(new Set());
    setSaveMsg(`Deleted ${selectedRows.size} row(s) (unsaved)`);
  };

  // ─── Toggle row selection ───────────────────────────────────────
  const toggleRow = (origIdx: number) => {
    const newSet = new Set(selectedRows);
    if (newSet.has(origIdx)) newSet.delete(origIdx);
    else newSet.add(origIdx);
    setSelectedRows(newSet);
  };

  // ─── Format cell value for display ──────────────────────────────
  const formatCell = (value: string | number, fieldDef: FieldDef): string => {
    if (fieldDef.type === 'flags' && typeof value === 'number') {
      return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
    }
    if (fieldDef.type === 'float' && typeof value === 'number') {
      return value.toFixed(4);
    }
    return String(value ?? '');
  };

  // ─── Get lookup display for ref fields ──────────────────────────
  const getLookupName = (value: string | number, fieldDef: FieldDef): string | null => {
    if (!data || !fieldDef.ref) return null;
    const lookupTable = data.lookups[fieldDef.ref];
    if (!lookupTable) return null;
    return lookupTable[String(value)] || null;
  };

  // ─── Get contextual display name ────────────────────────────────
  const getContextualName = (value: string | number, fieldDef: FieldDef): string | null => {
    const v = Number(value);
    if (fieldDef.name === 'RaceID' || fieldDef.name.includes('Race')) {
      return RACE_NAMES[v] || null;
    }
    if (fieldDef.name === 'ClassID' || fieldDef.name.includes('Class')) {
      return CLASS_NAMES[v] || null;
    }
    if (fieldDef.name === 'SexID') {
      return SEX_NAMES[v] || null;
    }
    if (fieldDef.name.startsWith('InventoryType')) {
      return INVENTORY_TYPES[v] || null;
    }
    return null;
  };

  // ─── Filtered file list ──────────────────────────────────────────
  const filteredFiles = useMemo(() => {
    if (!fileFilter) return files;
    const lower = fileFilter.toLowerCase();
    return files.filter(f => f.filename.toLowerCase().includes(lower));
  }, [files, fileFilter]);

  /* ════════════════════════════════════════════════════════════════
   *  RENDER
   * ════════════════════════════════════════════════════════════════ */

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 180px)', gap: 0, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      {/* ── Sidebar: File List ──────────────────────────────────── */}
      <div style={{
        width: 260,
        minWidth: 200,
        background: COLORS.bg,
        borderRight: `1px solid ${COLORS.border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.textBright, marginBottom: 8 }}>
            DBC Files
          </div>
          <input
            type="text"
            placeholder="Filter files..."
            value={fileFilter}
            onChange={e => setFileFilter(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 10px',
              background: COLORS.bgLight,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 6,
              color: COLORS.text,
              fontSize: 12,
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredFiles.map(f => (
            <div
              key={f.filename}
              onClick={() => loadFile(f.filename)}
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                background: selectedFile === f.filename ? COLORS.bgHover : 'transparent',
                borderLeft: selectedFile === f.filename ? `3px solid ${COLORS.accent}` : '3px solid transparent',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 12,
                color: selectedFile === f.filename ? COLORS.textBright : COLORS.text,
              }}
              onMouseEnter={e => {
                if (selectedFile !== f.filename) e.currentTarget.style.background = COLORS.bgHover;
              }}
              onMouseLeave={e => {
                if (selectedFile !== f.filename) e.currentTarget.style.background = 'transparent';
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.hasExport && <span style={{ color: COLORS.green, marginRight: 4 }} title="Export version exists">●</span>}
                {f.name}
              </span>
              <span style={{ color: COLORS.textDim, fontSize: 10, marginLeft: 4, flexShrink: 0 }}>
                {f.hasDefinition ? '◆' : ''}
                {f.recordCount !== null ? ` ${f.recordCount}` : ''}
              </span>
            </div>
          ))}
        </div>
        <div style={{ padding: 8, borderTop: `1px solid ${COLORS.border}`, fontSize: 10, color: COLORS.textDim }}>
          {files.length} files · <span style={{ color: COLORS.green }}>●</span> = export · ◆ = has schema
        </div>
      </div>

      {/* ── Main Content ───────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: COLORS.bg }}>
        {!data && !loading && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: COLORS.textDim,
            fontSize: 14,
          }}>
            Select a DBC file from the sidebar to begin editing
          </div>
        )}

        {loading && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: COLORS.accent,
            fontSize: 14,
          }}>
            Loading {selectedFile}...
          </div>
        )}

        {data && !loading && (
          <>
            {/* ── Toolbar ──────────────────────────────────────── */}
            <div style={{
              padding: '8px 12px',
              background: COLORS.bgLight,
              borderBottom: `1px solid ${COLORS.border}`,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
            }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: COLORS.textBright, marginRight: 8 }}>
                {data.filename}
                <span style={{ fontWeight: 400, fontSize: 11, color: COLORS.textDim, marginLeft: 8 }}>
                  {data.header.recordCount} records · {data.header.fieldCount} fields
                  · from {data.source}
                  {data.hasDefinition && ' · schema ◆'}
                </span>
              </div>

              <div style={{ flex: 1 }} />

              {/* Search */}
              <input
                type="text"
                placeholder="Search all fields..."
                value={globalSearch}
                onChange={e => { setGlobalSearch(e.target.value); setPage(0); }}
                style={{
                  padding: '4px 10px',
                  background: COLORS.bg,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 6,
                  color: COLORS.text,
                  fontSize: 12,
                  width: 200,
                  outline: 'none',
                }}
              />

              <label style={{ fontSize: 11, color: COLORS.textDim, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
                Show locale cols
              </label>
            </div>

            {/* ── Action bar ───────────────────────────────────── */}
            <div style={{
              padding: '6px 12px',
              background: COLORS.bgLight,
              borderBottom: `1px solid ${COLORS.border}`,
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
            }}>
              <ToolbarButton onClick={handleSave} disabled={saving || editedRecords.size === 0}
                color={COLORS.green} label={saving ? 'Saving...' : `Save (${editedRecords.size} edits)`} />
              {data.source === 'base' && (
                <ToolbarButton onClick={handleCopyToCustom} color={COLORS.orange} label="Copy to Export" />
              )}
              <ToolbarButton onClick={handleExportCSV} color={COLORS.accent} label="Export CSV" />
              <ToolbarButton onClick={handleDiff} disabled={diffLoading}
                color={COLORS.purple} label={diffLoading ? 'Comparing...' : 'Compare Base vs Export'} />
              <ToolbarButton onClick={() => setShowBatch(!showBatch)} color={COLORS.yellow}
                label={showBatch ? 'Hide Batch Edit' : 'Batch Edit'} />
              <div style={{ flex: 1 }} />
              <ToolbarButton onClick={handleAddRow} color={COLORS.green} label="+ Add Row" />
              {selectedRows.size > 0 && (
                <ToolbarButton onClick={handleDeleteSelected} color={COLORS.red}
                  label={`Delete ${selectedRows.size} Selected`} />
              )}
            </div>

            {/* ── Status message ────────────────────────────────── */}
            {saveMsg && (
              <div style={{
                padding: '6px 12px',
                fontSize: 12,
                color: saveMsg.startsWith('Error') ? COLORS.red : COLORS.green,
                background: saveMsg.startsWith('Error') ? '#2d1418' : '#0d2818',
                borderBottom: `1px solid ${COLORS.border}`,
              }}>
                {saveMsg}
              </div>
            )}

            {/* ── Batch edit panel ─────────────────────────────── */}
            {showBatch && (
              <div style={{
                padding: '10px 12px',
                background: '#1a1d23',
                borderBottom: `1px solid ${COLORS.border}`,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-end',
                flexWrap: 'wrap',
              }}>
                <div>
                  <label style={{ fontSize: 10, color: COLORS.textDim, display: 'block', marginBottom: 2 }}>Column</label>
                  <select
                    value={batchOp.column}
                    onChange={e => setBatchOp({ ...batchOp, column: Number(e.target.value) })}
                    style={{ padding: 4, background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 12 }}
                  >
                    {visibleColumns.map(col => (
                      <option key={col.index} value={col.index}>{col.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10, color: COLORS.textDim, display: 'block', marginBottom: 2 }}>Match</label>
                  <select
                    value={batchOp.matchType}
                    onChange={e => setBatchOp({ ...batchOp, matchType: e.target.value as 'exact' | 'contains' })}
                    style={{ padding: 4, background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 12 }}
                  >
                    <option value="exact">Exact</option>
                    <option value="contains">Contains</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10, color: COLORS.textDim, display: 'block', marginBottom: 2 }}>Find</label>
                  <input
                    value={batchOp.findValue}
                    onChange={e => setBatchOp({ ...batchOp, findValue: e.target.value })}
                    style={{ padding: 4, background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 12, width: 120 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: COLORS.textDim, display: 'block', marginBottom: 2 }}>Replace</label>
                  <input
                    value={batchOp.replaceValue}
                    onChange={e => setBatchOp({ ...batchOp, replaceValue: e.target.value })}
                    style={{ padding: 4, background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 12, width: 120 }}
                  />
                </div>
                <ToolbarButton onClick={executeBatch} color={COLORS.yellow} label="Apply" />
                {selectedRows.size > 0 && (
                  <span style={{ fontSize: 10, color: COLORS.textDim }}>
                    (applying to {selectedRows.size} selected rows)
                  </span>
                )}
                {batchResult && <span style={{ fontSize: 11, color: COLORS.green }}>{batchResult}</span>}
              </div>
            )}

            {/* ── Diff panel ───────────────────────────────────── */}
            {showDiff && diffData && (
              <div style={{
                padding: '10px 12px',
                background: '#1a1d23',
                borderBottom: `1px solid ${COLORS.border}`,
                maxHeight: 300,
                overflowY: 'auto',
                fontSize: 12,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong style={{ color: COLORS.textBright }}>
                    Diff: {diffData.summary.modified} modified, {diffData.summary.added} added, {diffData.summary.removed} removed
                  </strong>
                  <button onClick={() => setShowDiff(false)} style={{ background: 'none', border: 'none', color: COLORS.textDim, cursor: 'pointer' }}>Close</button>
                </div>
                {diffData.changes.length === 0 && diffData.added.length === 0 && diffData.removed.length === 0 && (
                  <div style={{ color: COLORS.green }}>No differences found</div>
                )}
                {diffData.changes.map(ch => (
                  <div key={ch.id} style={{ marginBottom: 6, padding: 6, background: COLORS.modified, borderRadius: 4 }}>
                    <div style={{ color: COLORS.orange, fontWeight: 600 }}>Record ID {ch.id}</div>
                    {ch.fields.map(f => (
                      <div key={f.fieldIndex} style={{ color: COLORS.text, paddingLeft: 12 }}>
                        <span style={{ color: COLORS.textDim }}>{f.fieldName}:</span>{' '}
                        <span style={{ color: COLORS.red }}>{String(f.baseValue)}</span>
                        {' → '}
                        <span style={{ color: COLORS.green }}>{String(f.customValue)}</span>
                      </div>
                    ))}
                  </div>
                ))}
                {diffData.added.map(a => (
                  <div key={a.id} style={{ color: COLORS.green, marginBottom: 2 }}>
                    + Added record ID {a.id}
                  </div>
                ))}
                {diffData.removed.map(r => (
                  <div key={r.id} style={{ color: COLORS.red, marginBottom: 2 }}>
                    - Removed record ID {r.id}
                  </div>
                ))}
              </div>
            )}

            {/* ── Table ────────────────────────────────────────── */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>
                      <input
                        type="checkbox"
                        checked={pageRecords.length > 0 && pageRecords.every(r => selectedRows.has(r.origIdx))}
                        onChange={e => {
                          const newSet = new Set(selectedRows);
                          for (const r of pageRecords) {
                            if (e.target.checked) newSet.add(r.origIdx);
                            else newSet.delete(r.origIdx);
                          }
                          setSelectedRows(newSet);
                        }}
                      />
                    </th>
                    <th style={thStyle}>#</th>
                    {visibleColumns.map(col => (
                      <th
                        key={col.index}
                        style={{ ...thStyle, cursor: 'pointer', userSelect: 'none', minWidth: 60 }}
                        onClick={() => {
                          if (sortCol === col.index) {
                            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortCol(col.index);
                            setSortDir('asc');
                          }
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span>{col.name}</span>
                            {sortCol === col.index && (
                              <span style={{ fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
                            )}
                            {col.ref && <span style={{ color: COLORS.purple, fontSize: 9 }}>ref</span>}
                          </div>
                          <span style={{ fontSize: 9, color: COLORS.textDim, fontWeight: 400 }}>{col.type}</span>
                          <input
                            type="text"
                            placeholder="filter"
                            value={columnFilters[col.index] || ''}
                            onChange={e => {
                              setColumnFilters({ ...columnFilters, [col.index]: e.target.value });
                              setPage(0);
                            }}
                            onClick={e => e.stopPropagation()}
                            style={{
                              padding: '2px 4px',
                              background: COLORS.bg,
                              border: `1px solid ${COLORS.border}`,
                              borderRadius: 3,
                              color: COLORS.text,
                              fontSize: 10,
                              width: '100%',
                              boxSizing: 'border-box',
                              outline: 'none',
                            }}
                          />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRecords.map(({ row, origIdx }, pageIdx) => {
                    const isEdited = editedRecords.has(origIdx);
                    const isSelected = selectedRows.has(origIdx);
                    return (
                      <tr
                        key={origIdx}
                        style={{
                          background: isSelected
                            ? '#1a2744'
                            : isEdited
                              ? COLORS.modified
                              : pageIdx % 2 === 0
                                ? COLORS.bg
                                : COLORS.bgLight,
                        }}
                      >
                        <td style={tdStyle}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(origIdx)}
                          />
                        </td>
                        <td style={{ ...tdStyle, color: COLORS.textDim }}>{origIdx}</td>
                        {visibleColumns.map(col => {
                          const val = row[col.index];
                          const isEditingThis = editingCell?.row === origIdx && editingCell?.col === col.index;
                          const lookupName = getLookupName(val, col);
                          const contextName = getContextualName(val, col);
                          const displayName = lookupName || contextName;

                          return (
                            <td
                              key={col.index}
                              style={{
                                ...tdStyle,
                                cursor: 'pointer',
                                background: isEditingThis ? COLORS.cellEdit : undefined,
                              }}
                              onDoubleClick={() => startEdit(origIdx, col.index)}
                            >
                              {isEditingThis ? (
                                <input
                                  ref={editInputRef}
                                  value={editingValue}
                                  onChange={e => setEditingValue(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') commitEdit();
                                    if (e.key === 'Escape') cancelEdit();
                                    if (e.key === 'Tab') {
                                      e.preventDefault();
                                      commitEdit();
                                      // Move to next visible column
                                      const curVisIdx = visibleColumns.findIndex(c => c.index === col.index);
                                      const nextCol = visibleColumns[curVisIdx + 1];
                                      if (nextCol) startEdit(origIdx, nextCol.index);
                                    }
                                  }}
                                  onBlur={commitEdit}
                                  style={{
                                    width: '100%',
                                    padding: '2px 4px',
                                    background: COLORS.bg,
                                    border: `1px solid ${COLORS.accent}`,
                                    borderRadius: 3,
                                    color: COLORS.textBright,
                                    fontSize: 12,
                                    outline: 'none',
                                    boxSizing: 'border-box',
                                  }}
                                  autoFocus
                                />
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ color: col.type === 'string' ? COLORS.green : COLORS.text }}>
                                    {formatCell(val, col)}
                                  </span>
                                  {displayName && (
                                    <span style={{
                                      fontSize: 10,
                                      color: COLORS.purple,
                                      opacity: 0.8,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      maxWidth: 120,
                                    }} title={displayName}>
                                      ({displayName})
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ───────────────────────────────────── */}
            <div style={{
              padding: '6px 12px',
              background: COLORS.bgLight,
              borderTop: `1px solid ${COLORS.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: COLORS.textDim,
            }}>
              <span>
                Showing {processedRecords.length === 0 ? 0 : page * pageSize + 1}–{Math.min((page + 1) * pageSize, processedRecords.length)} of {processedRecords.length}
                {processedRecords.length !== workingRecords.length && ` (filtered from ${workingRecords.length})`}
              </span>
              <div style={{ flex: 1 }} />
              <select
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }}
                style={{ padding: 3, background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 4, fontSize: 12 }}
              >
                <option value={50}>50 rows</option>
                <option value={100}>100 rows</option>
                <option value={250}>250 rows</option>
                <option value={500}>500 rows</option>
                <option value={1000}>1000 rows</option>
              </select>
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                style={pageBtnStyle}
              >
                ◀ Prev
              </button>
              <span>{page + 1} / {totalPages || 1}</span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                style={pageBtnStyle}
              >
                Next ▶
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  Sub-components
 * ────────────────────────────────────────────────────────────────── */

function ToolbarButton({ onClick, disabled, color, label }: {
  onClick: () => void;
  disabled?: boolean;
  color: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 10px',
        background: disabled ? '#21262d' : color + '22',
        color: disabled ? COLORS.textDim : color,
        border: `1px solid ${disabled ? COLORS.border : color + '55'}`,
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  Styles
 * ────────────────────────────────────────────────────────────────── */

const thStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  background: COLORS.bgLight,
  padding: '6px 8px',
  textAlign: 'left',
  borderBottom: `2px solid ${COLORS.border}`,
  color: COLORS.textBright,
  fontSize: 11,
  fontWeight: 600,
  zIndex: 10,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '3px 8px',
  borderBottom: `1px solid ${COLORS.border}`,
  color: COLORS.text,
  whiteSpace: 'nowrap',
  maxWidth: 300,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const pageBtnStyle: React.CSSProperties = {
  padding: '3px 8px',
  background: COLORS.bg,
  color: COLORS.text,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
};
