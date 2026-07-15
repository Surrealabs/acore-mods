import React, { useCallback, useEffect, useMemo, useState } from 'react';

/* ──────────────────────────────────────────────────────────────────
 *  Types
 * ────────────────────────────────────────────────────────────────── */

interface FieldDef {
  name: string;
  type: string;
  ref?: string | null;
  hidden?: boolean;
}

interface DBCData {
  filename: string;
  source: string;
  header: { recordCount: number; fieldCount: number };
  fieldDefs: FieldDef[];
  records: (string | number)[][];
  lookups: Record<string, Record<string, string>>;
}

interface OutfitEntry {
  origIdx: number;
  id: number;
  race: number;
  cls: number;
  sex: number;
  outfitId: number;
  items: number[];
  displayItems: number[];
  inventoryTypes: number[];
}

/* ──────────────────────────────────────────────────────────────────
 *  Constants
 * ────────────────────────────────────────────────────────────────── */

const RACE_NAMES: Record<number, string> = {
  1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf', 5: 'Undead',
  6: 'Tauren', 7: 'Gnome', 8: 'Troll', 10: 'Blood Elf', 11: 'Draenei',
};

const CLASS_NAMES: Record<number, string> = {
  1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest',
  6: 'Death Knight', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 11: 'Druid',
};

const SLOT_NAMES = [
  'Head', 'Neck', 'Shoulder', 'Body', 'Chest', 'Waist',
  'Legs', 'Feet', 'Wrists', 'Hands', 'Finger1', 'Finger2',
  'Trinket1', 'Trinket2', 'Back', 'MainHand', 'OffHand', 'Ranged',
  'Tabard', 'Slot20', 'Slot21', 'Slot22', 'Slot23', 'Slot24',
];

const INV_TYPES: Record<number, string> = {
  0: '-', 1: 'Head', 2: 'Neck', 3: 'Shoulder', 4: 'Shirt',
  5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrists',
  10: 'Hands', 11: 'Finger', 12: 'Trinket', 13: 'One-Hand', 14: 'Shield',
  15: 'Bow', 16: 'Back', 17: 'Two-Hand', 18: 'Bag',
  19: 'Tabard', 20: 'Robe', 21: 'Main Hand', 22: 'Off Hand',
  23: 'Holdable', 24: 'Ammo', 25: 'Thrown', 26: 'Wand',
  28: 'Relic',
};

const COLORS = {
  bg: '#0d1117',
  bgLight: '#161b22',
  bgHover: '#1c2333',
  border: '#30363d',
  text: '#c9d1d9',
  textDim: '#8b949e',
  textBright: '#f0f6fc',
  accent: '#58a6ff',
  green: '#3fb950',
  red: '#f85149',
  orange: '#d29922',
  purple: '#bc8cff',
  yellow: '#e3b341',
};

// Class color map (WoW standard)
const CLASS_COLORS: Record<number, string> = {
  1: '#C79C6E', 2: '#F58CBA', 3: '#ABD473', 4: '#FFF569', 5: '#FFFFFF',
  6: '#C41F3B', 7: '#0070DE', 8: '#69CCF0', 9: '#9482C9', 11: '#FF7D0A',
};

/* ──────────────────────────────────────────────────────────────────
 *  Component
 * ────────────────────────────────────────────────────────────────── */

interface Props {
  textColor: string;
  contentBoxColor: string;
}

export default function CharStartOutfitEditor({ textColor: _tc, contentBoxColor: _cbc }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DBCData | null>(null);
  const [outfits, setOutfits] = useState<OutfitEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Filters
  const [filterRace, setFilterRace] = useState<number | 'all'>('all');
  const [filterClass, setFilterClass] = useState<number | 'all'>('all');
  const [filterSex, setFilterSex] = useState<number | 'all'>('all');

  // Editing
  const [editingOutfit, setEditingOutfit] = useState<OutfitEntry | null>(null);
  const [editValues, setEditValues] = useState<{ items: number[]; displayItems: number[]; inventoryTypes: number[] }>({
    items: [], displayItems: [], inventoryTypes: [],
  });

  // Copy/paste
  const [clipboard, setClipboard] = useState<{ items: number[]; displayItems: number[]; inventoryTypes: number[] } | null>(null);

  // ─── Load data ────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dbc/read/CharStartOutfit.dbc');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);

      // Parse outfits from raw records
      const entries: OutfitEntry[] = json.records.map((row: number[], idx: number) => ({
        origIdx: idx,
        id: row[0],
        race: row[1],
        cls: row[2],
        sex: row[3],
        outfitId: row[4],
        items: row.slice(5, 29),
        displayItems: row.slice(29, 53),
        inventoryTypes: row.slice(53, 77),
      }));

      setOutfits(entries);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Filtered outfits ────────────────────────────────────────────
  const filteredOutfits = useMemo(() => {
    return outfits.filter(o => {
      if (filterRace !== 'all' && o.race !== filterRace) return false;
      if (filterClass !== 'all' && o.cls !== filterClass) return false;
      if (filterSex !== 'all' && o.sex !== filterSex) return false;
      return true;
    });
  }, [outfits, filterRace, filterClass, filterSex]);

  // ─── Edit an outfit ──────────────────────────────────────────────
  const startEdit = (outfit: OutfitEntry) => {
    setEditingOutfit(outfit);
    setEditValues({
      items: [...outfit.items],
      displayItems: [...outfit.displayItems],
      inventoryTypes: [...outfit.inventoryTypes],
    });
  };

  const cancelEdit = () => {
    setEditingOutfit(null);
  };

  const saveEdit = () => {
    if (!editingOutfit || !data) return;

    const newOutfits = outfits.map(o => {
      if (o.origIdx !== editingOutfit.origIdx) return o;
      return {
        ...o,
        items: [...editValues.items],
        displayItems: [...editValues.displayItems],
        inventoryTypes: [...editValues.inventoryTypes],
      };
    });

    setOutfits(newOutfits);
    setEditingOutfit(null);
    setSaveMsg('Changes applied (unsaved to file - click Save All)');
  };

  // ─── Copy outfit items ──────────────────────────────────────────
  const copyOutfit = (outfit: OutfitEntry) => {
    setClipboard({
      items: [...outfit.items],
      displayItems: [...outfit.displayItems],
      inventoryTypes: [...outfit.inventoryTypes],
    });
    setSaveMsg(`Copied equipment from ${RACE_NAMES[outfit.race]} ${CLASS_NAMES[outfit.cls]} (${outfit.sex === 0 ? 'M' : 'F'})`);
  };

  const pasteOutfit = (outfit: OutfitEntry) => {
    if (!clipboard) return;
    const newOutfits = outfits.map(o => {
      if (o.origIdx !== outfit.origIdx) return o;
      return {
        ...o,
        items: [...clipboard.items],
        displayItems: [...clipboard.displayItems],
        inventoryTypes: [...clipboard.inventoryTypes],
      };
    });
    setOutfits(newOutfits);
    setSaveMsg(`Pasted equipment to ${RACE_NAMES[outfit.race]} ${CLASS_NAMES[outfit.cls]} (${outfit.sex === 0 ? 'M' : 'F'}) - unsaved`);
  };

  // ─── Save all to DBC ────────────────────────────────────────────
  const saveAll = async () => {
    if (!data) return;
    setSaving(true);
    setSaveMsg(null);

    try {
      // Reconstruct records from outfit entries
      const records = outfits.map(o => [
        o.id, o.race, o.cls, o.sex, o.outfitId,
        ...o.items, ...o.displayItems, ...o.inventoryTypes,
      ]);

      const res = await fetch('/api/dbc/save/CharStartOutfit.dbc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records,
          fieldDefs: data.fieldDefs,
        }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      setSaveMsg(`Saved ${result.recordCount} outfits to export/DBFilesClient/CharStartOutfit.dbc`);
    } catch (err: unknown) {
      setSaveMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  // ─── Copy base to export ────────────────────────────────────────
  const copyToCustom = async () => {
    try {
      const res = await fetch('/api/dbc/copy-to-custom/CharStartOutfit.dbc', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setSaveMsg('Copied base CharStartOutfit.dbc to export/DBFilesClient/');
      await loadData();
    } catch (err: unknown) {
      setSaveMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /* ════════════════════════════════════════════════════════════════
   *  RENDER
   * ════════════════════════════════════════════════════════════════ */

  if (loading) {
    return <div style={{ padding: 24, color: COLORS.accent }}>Loading CharStartOutfit.dbc...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ color: COLORS.red, marginBottom: 12 }}>Error: {error}</div>
        <button onClick={loadData} style={btnStyle(COLORS.accent)}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", color: COLORS.text }}>
      {/* ── Header ──────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 0',
        borderBottom: `1px solid ${COLORS.border}`,
        marginBottom: 12,
        flexWrap: 'wrap',
      }}>
        <h3 style={{ margin: 0, color: COLORS.textBright }}>Starting Equipment Editor</h3>
        <span style={{ color: COLORS.textDim, fontSize: 12 }}>
          {outfits.length} outfits · {filteredOutfits.length} shown
          {data?.source === 'base' && ' · reading from base (read-only, copy to export first)'}
        </span>

        <div style={{ flex: 1 }} />

        {data?.source === 'base' && (
          <button onClick={copyToCustom} style={btnStyle(COLORS.orange)}>Copy to Export</button>
        )}
        <button onClick={saveAll} disabled={saving} style={btnStyle(COLORS.green)}>
          {saving ? 'Saving...' : 'Save All'}
        </button>
      </div>

      {saveMsg && (
        <div style={{
          padding: '6px 12px',
          marginBottom: 12,
          fontSize: 12,
          borderRadius: 6,
          color: saveMsg.startsWith('Error') ? COLORS.red : COLORS.green,
          background: saveMsg.startsWith('Error') ? '#2d1418' : '#0d2818',
          border: `1px solid ${saveMsg.startsWith('Error') ? COLORS.red + '33' : COLORS.green + '33'}`,
        }}>
          {saveMsg}
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        gap: 12,
        marginBottom: 16,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <FilterSelect
          label="Race"
          value={filterRace}
          onChange={v => setFilterRace(v === 'all' ? 'all' : Number(v))}
          options={[
            { value: 'all', label: 'All Races' },
            ...Object.entries(RACE_NAMES).map(([v, l]) => ({ value: v, label: l })),
          ]}
        />
        <FilterSelect
          label="Class"
          value={filterClass}
          onChange={v => setFilterClass(v === 'all' ? 'all' : Number(v))}
          options={[
            { value: 'all', label: 'All Classes' },
            ...Object.entries(CLASS_NAMES).map(([v, l]) => ({ value: v, label: l })),
          ]}
        />
        <FilterSelect
          label="Sex"
          value={filterSex}
          onChange={v => setFilterSex(v === 'all' ? 'all' : Number(v))}
          options={[
            { value: 'all', label: 'Both' },
            { value: '0', label: 'Male' },
            { value: '1', label: 'Female' },
          ]}
        />

        {clipboard && (
          <span style={{ fontSize: 11, color: COLORS.yellow, padding: '4px 8px', background: COLORS.yellow + '15', borderRadius: 4 }}>
            Clipboard: equipment copied
          </span>
        )}
      </div>

      {/* ── Outfit Cards ────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))', gap: 12 }}>
        {filteredOutfits.map(outfit => (
          <OutfitCard
            key={outfit.origIdx}
            outfit={outfit}
            isEditing={editingOutfit?.origIdx === outfit.origIdx}
            editValues={editingOutfit?.origIdx === outfit.origIdx ? editValues : null}
            onEdit={() => startEdit(outfit)}
            onCancel={cancelEdit}
            onSave={saveEdit}
            onCopy={() => copyOutfit(outfit)}
            onPaste={() => pasteOutfit(outfit)}
            hasClipboard={!!clipboard}
            onEditValueChange={(slot, field, value) => {
              const newVals = { ...editValues };
              if (field === 'item') newVals.items[slot] = value;
              else if (field === 'display') newVals.displayItems[slot] = value;
              else if (field === 'invType') newVals.inventoryTypes[slot] = value;
              setEditValues(newVals);
            }}
          />
        ))}
      </div>

      {filteredOutfits.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: COLORS.textDim }}>
          No outfits match the current filters
        </div>
      )}

      {/* ── Edit Modal ──────────────────────────────────────── */}
      {editingOutfit && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={cancelEdit}>
          <div style={{
            background: COLORS.bgLight,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
            padding: 24,
            maxWidth: 700,
            width: '95vw',
            maxHeight: '85vh',
            overflowY: 'auto',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', color: CLASS_COLORS[editingOutfit.cls] || COLORS.textBright }}>
              Edit: {RACE_NAMES[editingOutfit.race]} {CLASS_NAMES[editingOutfit.cls]} ({editingOutfit.sex === 0 ? 'Male' : 'Female'})
            </h3>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={thStyleOutfit}>Slot</th>
                  <th style={thStyleOutfit}>Item ID</th>
                  <th style={thStyleOutfit}>Display ID</th>
                  <th style={thStyleOutfit}>Inv Type</th>
                </tr>
              </thead>
              <tbody>
                {SLOT_NAMES.map((slotName, i) => {
                  const item = editValues.items[i];
                  const isEmpty = item === 0 || item === -1;
                  return (
                    <tr key={i} style={{
                      background: isEmpty ? 'transparent' : COLORS.bgHover,
                      opacity: isEmpty ? 0.5 : 1,
                    }}>
                      <td style={tdStyleOutfit}>
                        <span style={{ color: COLORS.textDim }}>{i + 1}.</span> {slotName}
                      </td>
                      <td style={tdStyleOutfit}>
                        <input
                          type="number"
                          value={editValues.items[i]}
                          onChange={e => {
                            const newVals = { ...editValues };
                            newVals.items[i] = parseInt(e.target.value) || 0;
                            setEditValues(newVals);
                          }}
                          style={inputStyle}
                        />
                      </td>
                      <td style={tdStyleOutfit}>
                        <input
                          type="number"
                          value={editValues.displayItems[i]}
                          onChange={e => {
                            const newVals = { ...editValues };
                            newVals.displayItems[i] = parseInt(e.target.value) || 0;
                            setEditValues(newVals);
                          }}
                          style={inputStyle}
                        />
                      </td>
                      <td style={tdStyleOutfit}>
                        <select
                          value={editValues.inventoryTypes[i]}
                          onChange={e => {
                            const newVals = { ...editValues };
                            newVals.inventoryTypes[i] = parseInt(e.target.value) || 0;
                            setEditValues(newVals);
                          }}
                          style={{ ...inputStyle, width: 120 }}
                        >
                          {Object.entries(INV_TYPES).map(([v, l]) => (
                            <option key={v} value={v}>{v}: {l}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={cancelEdit} style={btnStyle(COLORS.textDim)}>Cancel</button>
              <button onClick={saveEdit} style={btnStyle(COLORS.green)}>Apply Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  Outfit Card
 * ────────────────────────────────────────────────────────────────── */

interface OutfitCardProps {
  outfit: OutfitEntry;
  isEditing: boolean;
  editValues: { items: number[]; displayItems: number[]; inventoryTypes: number[] } | null;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onCopy: () => void;
  onPaste: () => void;
  hasClipboard: boolean;
  onEditValueChange: (slot: number, field: 'item' | 'display' | 'invType', value: number) => void;
}

function OutfitCard({ outfit, onEdit, onCopy, onPaste, hasClipboard }: OutfitCardProps) {
  const classColor = CLASS_COLORS[outfit.cls] || COLORS.text;
  const equippedSlots = outfit.items.filter(id => id !== 0 && id !== -1).length;

  return (
    <div style={{
      background: COLORS.bgLight,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 8,
      padding: 12,
      borderLeft: `3px solid ${classColor}`,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <span style={{ fontWeight: 700, color: classColor, fontSize: 14 }}>
            {CLASS_NAMES[outfit.cls] || `Class ${outfit.cls}`}
          </span>
          <span style={{ color: COLORS.textDim, fontSize: 12, marginLeft: 8 }}>
            {RACE_NAMES[outfit.race] || `Race ${outfit.race}`}
            {' · '}
            {outfit.sex === 0 ? 'Male' : 'Female'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onCopy} style={smallBtnStyle} title="Copy equipment">Copy</button>
          {hasClipboard && (
            <button onClick={onPaste} style={smallBtnStyle} title="Paste equipment">Paste</button>
          )}
          <button onClick={onEdit} style={{ ...smallBtnStyle, color: COLORS.accent, borderColor: COLORS.accent + '55' }}>
            Edit
          </button>
        </div>
      </div>

      {/* Equipment grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '2px 8px',
        fontSize: 11,
      }}>
        {SLOT_NAMES.slice(0, 20).map((slotName, i) => {
          const item = outfit.items[i];
          const isEmpty = item === 0 || item === -1;
          return (
            <div key={i} style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '1px 0',
              color: isEmpty ? COLORS.textDim + '55' : COLORS.text,
            }}>
              <span style={{ color: COLORS.textDim, fontSize: 10 }}>{slotName}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {isEmpty ? '-' : item}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 6, fontSize: 10, color: COLORS.textDim }}>
        {equippedSlots} items equipped · ID: {outfit.id}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  Sub-components
 * ────────────────────────────────────────────────────────────────── */

function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string | number;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label style={{ fontSize: 10, color: COLORS.textDim, display: 'block', marginBottom: 2 }}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: '4px 8px',
          background: COLORS.bg,
          color: COLORS.text,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 6,
          fontSize: 12,
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  Styles
 * ────────────────────────────────────────────────────────────────── */

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '6px 14px',
    background: color + '22',
    color,
    border: `1px solid ${color}55`,
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  };
}

const smallBtnStyle: React.CSSProperties = {
  padding: '2px 8px',
  background: 'transparent',
  color: COLORS.textDim,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 10,
};

const thStyleOutfit: React.CSSProperties = {
  padding: '6px 8px',
  textAlign: 'left',
  borderBottom: `2px solid ${COLORS.border}`,
  color: COLORS.textBright,
  fontSize: 11,
  fontWeight: 600,
};

const tdStyleOutfit: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: `1px solid ${COLORS.border}`,
  color: COLORS.text,
};

const inputStyle: React.CSSProperties = {
  padding: '3px 6px',
  background: COLORS.bg,
  color: COLORS.text,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 4,
  fontSize: 12,
  width: 80,
};
