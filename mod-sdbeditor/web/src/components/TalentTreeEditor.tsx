import React, { useCallback, useEffect, useMemo, useState } from 'react';

/* ──────────────────────────────────────────────────────────────────
 *  Types  (matches talent-config.json schema)
 * ────────────────────────────────────────────────────────────────── */

interface Prereq { id: number; rank: number; }

interface TalentDef {
  row: number;       // 1-based display row
  col: number;       // 1-based display column
  maxRank: number;
  spells: number[];
  prereqs?: Prereq[];
  flags?: number;
  mastery?: boolean;
}

interface TabDef {
  name: string;
  tabId: number;
  masteryTalentId: number;
  talents: Record<string, TalentDef>;
}

interface ClassDef {
  className: string;
  tabs: Record<string, TabDef>;
}

interface TalentConfig {
  classes: Record<string, ClassDef>;
}

/* ──────────────────────────────────────────────────────────────────
 *  Constants
 * ────────────────────────────────────────────────────────────────── */

const CLASS_NAMES: Record<number, string> = {
  1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest',
  6: 'Death Knight', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 11: 'Druid',
};

const CLASS_COLORS: Record<number, string> = {
  1: '#C79C6E', 2: '#F58CBA', 3: '#ABD473', 4: '#FFF569', 5: '#FFFFFF',
  6: '#C41F3B', 7: '#0070DE', 8: '#69CCF0', 9: '#9482C9', 11: '#FF7D0A',
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

const ORDERED_CLASSES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11];

/* ──────────────────────────────────────────────────────────────────
 *  Component
 * ────────────────────────────────────────────────────────────────── */

interface Props {
  textColor: string;
  contentBoxColor: string;
}

export default function TalentTreeEditor({ textColor: _tc, contentBoxColor: _cbc }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [importing, setImporting] = useState(false);

  const [config, setConfig] = useState<TalentConfig>({ classes: {} });
  const [selectedClass, setSelectedClass] = useState<number>(1);
  const [selectedTalentId, setSelectedTalentId] = useState<number | null>(null);
  const [selectedTabIdx, setSelectedTabIdx] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string | number>>({});
  const [dirty, setDirty] = useState(false);

  // ─── Load config ──────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/talent-config');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConfig(data);
      setDirty(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // ─── Helpers ──────────────────────────────────────────────────────
  const classDef = config.classes?.[selectedClass];
  const totalTalents = useMemo(() => {
    let count = 0;
    for (const cls of Object.values(config.classes || {})) {
      for (const tab of Object.values(cls.tabs || {})) {
        count += Object.keys(tab.talents || {}).length;
      }
    }
    return count;
  }, [config]);

  const classTalentCount = useMemo(() => {
    if (!classDef) return 0;
    let c = 0;
    for (const tab of Object.values(classDef.tabs || {})) {
      c += Object.keys(tab.talents || {}).length;
    }
    return c;
  }, [classDef]);

  const getGridSize = (tab: TabDef) => {
    let maxRow = 0, maxCol = 0;
    for (const t of Object.values(tab.talents || {})) {
      if (t.row > maxRow) maxRow = t.row;
      if (t.col > maxCol) maxCol = t.col;
    }
    return { rows: Math.max(maxRow + 1, 7), cols: Math.max(maxCol + 1, 5) };
  };

  const getSelectedTalent = (): TalentDef | null => {
    if (!selectedTalentId || !selectedTabIdx || !classDef) return null;
    return classDef.tabs?.[selectedTabIdx]?.talents?.[selectedTalentId] || null;
  };

  // ─── Select talent for editing ────────────────────────────────────
  const selectTalent = (tabIdx: number, talentId: number) => {
    const tab = classDef?.tabs?.[tabIdx];
    if (!tab) return;
    const t = tab.talents[talentId];
    if (!t) return;
    setSelectedTalentId(talentId);
    setSelectedTabIdx(tabIdx);
    setEditValues({
      row: t.row,
      col: t.col,
      maxRank: t.maxRank,
      flags: t.flags || 0,
      mastery: t.mastery ? 1 : 0,
      ...Object.fromEntries((t.spells || []).map((s, i) => [`spell_${i}`, s])),
      prereq_0_id: t.prereqs?.[0]?.id || 0,
      prereq_0_rank: t.prereqs?.[0]?.rank || 0,
      prereq_1_id: t.prereqs?.[1]?.id || 0,
      prereq_1_rank: t.prereqs?.[1]?.rank || 0,
    });
  };

  // ─── Apply edits to config ────────────────────────────────────────
  const applyEdit = () => {
    if (!selectedTalentId || !selectedTabIdx || !classDef) return;
    const newConfig = JSON.parse(JSON.stringify(config)) as TalentConfig;
    const tab = newConfig.classes[selectedClass].tabs[selectedTabIdx];
    if (!tab) return;

    const spells: number[] = [];
    for (let i = 0; i < 9; i++) {
      const v = Number(editValues[`spell_${i}`]) || 0;
      if (v > 0) spells.push(v);
    }

    const prereqs: Prereq[] = [];
    for (let i = 0; i < 2; i++) {
      const pid = Number(editValues[`prereq_${i}_id`]) || 0;
      const prank = Number(editValues[`prereq_${i}_rank`]) || 0;
      if (pid > 0) prereqs.push({ id: pid, rank: prank });
    }

    const updated: TalentDef = {
      row: Number(editValues.row) || 1,
      col: Number(editValues.col) || 1,
      maxRank: spells.length || Number(editValues.maxRank) || 1,
      spells,
    };
    if (prereqs.length > 0) updated.prereqs = prereqs;
    if (Number(editValues.flags) > 0) updated.flags = Number(editValues.flags);
    if (Number(editValues.mastery)) updated.mastery = true;

    tab.talents[selectedTalentId] = updated;
    setConfig(newConfig);
    setDirty(true);
    setMsg('Changes applied locally — click Save to persist');
  };

  // ─── Add new talent ───────────────────────────────────────────────
  const addTalent = (tabIdx: number, row: number, col: number) => {
    const newConfig = JSON.parse(JSON.stringify(config)) as TalentConfig;
    if (!newConfig.classes[selectedClass]) return;
    const tab = newConfig.classes[selectedClass].tabs[tabIdx];
    if (!tab) return;

    let maxId = 0;
    for (const cls of Object.values(newConfig.classes)) {
      for (const t of Object.values(cls.tabs)) {
        for (const tid of Object.keys(t.talents)) {
          maxId = Math.max(maxId, Number(tid));
        }
      }
    }
    const newId = maxId + 1;

    tab.talents[newId] = { row, col, maxRank: 1, spells: [0] };

    setConfig(newConfig);
    setDirty(true);
    selectTalent(tabIdx, newId);
    setMsg(`Added talent #${newId} at row ${row}, col ${col}`);
  };

  // ─── Delete talent ────────────────────────────────────────────────
  const deleteTalent = () => {
    if (!selectedTalentId || !selectedTabIdx) return;
    const newConfig = JSON.parse(JSON.stringify(config)) as TalentConfig;
    const tab = newConfig.classes?.[selectedClass]?.tabs?.[selectedTabIdx];
    if (!tab) return;
    delete tab.talents[selectedTalentId];
    setConfig(newConfig);
    setDirty(true);
    setSelectedTalentId(null);
    setSelectedTabIdx(null);
    setMsg(`Deleted talent #${selectedTalentId}`);
  };

  // ─── Save config (JSON) ──────────────────────────────────────────
  const saveConfig = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/talent-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setDirty(false);
      setMsg('Saved talent config');
    } catch (err: unknown) {
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  // ─── Deploy: generate Lua config ─────────────────────────────────
  const deployConfig = async () => {
    setDeploying(true);
    setMsg(null);
    try {
      if (dirty) {
        const saveRes = await fetch('/api/talent-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });
        if (!saveRes.ok) throw new Error('Failed to save before deploy');
        setDirty(false);
      }
      const res = await fetch('/api/talent-config/deploy', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setMsg(`Deployed! ${result.talents} talents -> ${result.luaPath} (${result.bytes} bytes). Restart worldserver to apply.`);
    } catch (err: unknown) {
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeploying(false);
    }
  };

  // ─── Import from DBC (migration) ─────────────────────────────────
  const importFromDbc = async () => {
    if (!confirm('This will replace the current talent config with data from Talent.dbc. Continue?')) return;
    setImporting(true);
    setMsg(null);
    try {
      const res = await fetch('/api/talent-config/import-dbc', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setMsg(`Imported ${result.imported} talents from DBC`);
      await loadConfig();
    } catch (err: unknown) {
      setMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  /* ════════════════════════════════════════════════════════════════
   *  RENDER
   * ════════════════════════════════════════════════════════════════ */

  if (loading) return <div style={{ padding: 24, color: COLORS.accent }}>Loading talent config...</div>;
  if (error) return <div style={{ padding: 24, color: COLORS.red }}>Error: {error}</div>;

  const classColor = CLASS_COLORS[selectedClass] || COLORS.text;
  const selectedTalent = getSelectedTalent();
  const isEmpty = totalTalents === 0;

  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", color: COLORS.text }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0',
        borderBottom: `1px solid ${COLORS.border}`, marginBottom: 16, flexWrap: 'wrap',
      }}>
        <h3 style={{ margin: 0, color: COLORS.textBright }}>Talent Tree Editor</h3>
        <span style={{ color: COLORS.textDim, fontSize: 12 }}>
          {totalTalents} talents {dirty && '• unsaved changes'}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={importFromDbc} disabled={importing} style={btnStyle(COLORS.orange)}>
          {importing ? 'Importing...' : 'Import from DBC'}
        </button>
        <button onClick={saveConfig} disabled={saving || !dirty} style={btnStyle(COLORS.accent)}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={deployConfig} disabled={deploying} style={btnStyle(COLORS.green)}>
          {deploying ? 'Deploying...' : 'Deploy to Server'}
        </button>
      </div>

      {msg && (
        <div style={{
          padding: '6px 12px', marginBottom: 12, fontSize: 12, borderRadius: 6,
          color: msg.startsWith('Error') ? COLORS.red : COLORS.green,
          background: msg.startsWith('Error') ? '#2d1418' : '#0d2818',
        }}>
          {msg}
        </div>
      )}

      {isEmpty && (
        <div style={{
          padding: 32, textAlign: 'center', color: COLORS.textDim,
          background: COLORS.bgLight, borderRadius: 8, marginBottom: 16,
          border: `1px dashed ${COLORS.border}`,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
          <div style={{ fontSize: 16 }}>No talent data loaded</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>
            Click <strong>Import from DBC</strong> to migrate existing talent data, or start adding talents manually.
          </div>
        </div>
      )}

      {/* Class selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {ORDERED_CLASSES.map(cid => {
          const isActive = cid === selectedClass;
          const hasData = !!config.classes?.[cid];
          return (
            <button
              key={cid}
              onClick={() => { setSelectedClass(cid); setSelectedTalentId(null); setSelectedTabIdx(null); }}
              style={{
                padding: '6px 14px',
                background: isActive ? (CLASS_COLORS[cid] || COLORS.accent) + '33' : 'transparent',
                color: CLASS_COLORS[cid] || COLORS.text,
                border: `1px solid ${isActive ? (CLASS_COLORS[cid] || COLORS.accent) : COLORS.border}`,
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: isActive ? 700 : 400,
                opacity: hasData ? 1 : 0.4,
              }}
            >
              {CLASS_NAMES[cid]}
            </button>
          );
        })}
      </div>

      {/* Trees + Editor */}
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1, display: 'flex', gap: 12, overflowX: 'auto' }}>
          {classDef && Object.entries(classDef.tabs).sort(([a], [b]) => Number(a) - Number(b)).map(([tabIdxStr, tab]) => {
            const tabIdx = Number(tabIdxStr);
            const { rows, cols } = getGridSize(tab);
            const talentCount = Object.keys(tab.talents).length;

            return (
              <div key={tabIdx} style={{
                background: COLORS.bgLight,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: 12,
                minWidth: 200,
                flex: 1,
              }}>
                <div style={{
                  textAlign: 'center', fontWeight: 700, fontSize: 13,
                  color: classColor, marginBottom: 12,
                  borderBottom: `1px solid ${COLORS.border}`, paddingBottom: 8,
                }}>
                  {tab.name}
                  <span style={{ color: COLORS.textDim, fontWeight: 400, fontSize: 10, marginLeft: 6 }}>
                    ({talentCount} talents)
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateRows: `repeat(${rows}, 1fr)`, gap: 4 }}>
                  {Array.from({ length: rows }, (_, rowIdx) => {
                    const row = rowIdx + 1;
                    return (
                      <div key={rowIdx} style={{
                        display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4,
                      }}>
                        {Array.from({ length: cols }, (_, colIdx) => {
                          const col = colIdx + 1;
                          const [talentId, talent] = Object.entries(tab.talents)
                            .find(([, t]) => t.row === row && t.col === col) || [null, null];

                          const isSelected = selectedTalentId === Number(talentId) && selectedTabIdx === tabIdx;

                          if (talent && talentId) {
                            const tid = Number(talentId);
                            return (
                              <div
                                key={colIdx}
                                onClick={() => selectTalent(tabIdx, tid)}
                                style={{
                                  width: 42, height: 42,
                                  background: isSelected ? classColor + '44' : COLORS.bgHover,
                                  border: `2px solid ${isSelected ? classColor : talent.mastery ? COLORS.yellow : COLORS.border}`,
                                  borderRadius: 6,
                                  display: 'flex', flexDirection: 'column',
                                  alignItems: 'center', justifyContent: 'center',
                                  cursor: 'pointer', fontSize: 9,
                                  color: COLORS.textBright, position: 'relative',
                                }}
                                title={`ID: ${tid}, Spells: [${talent.spells.join(',')}], Ranks: ${talent.maxRank}${talent.mastery ? ' (MASTERY)' : ''}`}
                              >
                                <span style={{ fontWeight: 700, fontSize: 11 }}>{tid}</span>
                                <span style={{ color: COLORS.textDim }}>R{talent.maxRank}</span>
                                {talent.prereqs && talent.prereqs.length > 0 && (
                                  <div style={{
                                    position: 'absolute', top: -2, right: -2,
                                    width: 6, height: 6, borderRadius: 3,
                                    background: COLORS.orange,
                                  }} title={`Requires talent ${talent.prereqs[0]?.id}`} />
                                )}
                                {talent.mastery && (
                                  <div style={{
                                    position: 'absolute', bottom: -2, left: -2,
                                    width: 6, height: 6, borderRadius: 3,
                                    background: COLORS.yellow,
                                  }} title="Mastery talent" />
                                )}
                              </div>
                            );
                          }

                          return (
                            <div
                              key={colIdx}
                              onClick={() => addTalent(tabIdx, row, col)}
                              style={{
                                width: 42, height: 42,
                                background: 'transparent',
                                border: `1px dashed ${COLORS.border}`,
                                borderRadius: 6,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer', fontSize: 14, color: COLORS.border,
                              }}
                              title={`Add talent at row ${row}, col ${col}`}
                            >
                              +
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {!classDef && (
            <div style={{ color: COLORS.textDim, padding: 32, textAlign: 'center', flex: 1 }}>
              No talent data for {CLASS_NAMES[selectedClass]}. Click <strong>Import from DBC</strong> to load existing data.
            </div>
          )}
        </div>

        {/* Properties panel */}
        <div style={{
          width: 320, background: COLORS.bgLight,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 8, padding: 16,
          overflowY: 'auto', maxHeight: 'calc(100vh - 300px)',
        }}>
          {selectedTalent && selectedTalentId ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, color: classColor }}>
                  Talent #{selectedTalentId}
                  {selectedTalent.mastery && <span style={{ color: COLORS.yellow, fontSize: 10, marginLeft: 6 }}>★ MASTERY</span>}
                </h4>
                <button onClick={deleteTalent}
                  style={{ ...smallBtnStyle, color: COLORS.red, borderColor: COLORS.red + '55' }}>
                  Delete
                </button>
              </div>

              <FieldGroup label="Position (1-based)">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <LabeledInput label="Row" value={editValues.row} onChange={v => setEditValues({ ...editValues, row: v })} />
                  <LabeledInput label="Column" value={editValues.col} onChange={v => setEditValues({ ...editValues, col: v })} />
                </div>
              </FieldGroup>

              <FieldGroup label="Spell IDs (one per rank)">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                  {Array.from({ length: 9 }, (_, i) => (
                    <LabeledInput key={i} label={`Rank ${i + 1}`}
                      value={editValues[`spell_${i}`] ?? 0}
                      onChange={v => setEditValues({ ...editValues, [`spell_${i}`]: v })} />
                  ))}
                </div>
              </FieldGroup>

              <FieldGroup label="Prerequisites">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  <LabeledInput label="Talent ID 1" value={editValues.prereq_0_id} onChange={v => setEditValues({ ...editValues, prereq_0_id: v })} />
                  <LabeledInput label="Rank 1" value={editValues.prereq_0_rank} onChange={v => setEditValues({ ...editValues, prereq_0_rank: v })} />
                  <LabeledInput label="Talent ID 2" value={editValues.prereq_1_id} onChange={v => setEditValues({ ...editValues, prereq_1_id: v })} />
                  <LabeledInput label="Rank 2" value={editValues.prereq_1_rank} onChange={v => setEditValues({ ...editValues, prereq_1_rank: v })} />
                </div>
              </FieldGroup>

              <FieldGroup label="Other">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <LabeledInput label="Flags" value={editValues.flags} onChange={v => setEditValues({ ...editValues, flags: v })} />
                  <LabeledInput label="Mastery (0/1)" value={editValues.mastery} onChange={v => setEditValues({ ...editValues, mastery: v })} />
                </div>
              </FieldGroup>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={applyEdit} style={btnStyle(COLORS.green)}>Apply</button>
                <button onClick={() => { setSelectedTalentId(null); setSelectedTabIdx(null); }} style={btnStyle(COLORS.textDim)}>Deselect</button>
              </div>
            </>
          ) : (
            <div style={{ color: COLORS.textDim, textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>&#9670;</div>
              <div>Click a talent in the tree to edit it</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Click an empty slot (+) to add a new talent</div>
            </div>
          )}
        </div>
      </div>

      {/* Talent Table */}
      {classDef && (
        <div style={{ marginTop: 24 }}>
          <h4 style={{ color: COLORS.textBright, margin: '0 0 8px' }}>
            All Talents for {CLASS_NAMES[selectedClass]} ({classTalentCount})
          </h4>
          <div style={{ maxHeight: 300, overflowY: 'auto', border: `1px solid ${COLORS.border}`, borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  {['ID', 'Tab', 'Row', 'Col', 'Ranks', 'Spell 1', 'Prereq', 'Flags', 'Mastery'].map(h => (
                    <th key={h} style={{
                      padding: '4px 8px', textAlign: 'left', borderBottom: `2px solid ${COLORS.border}`,
                      color: COLORS.textBright, fontSize: 10, fontWeight: 600, position: 'sticky', top: 0,
                      background: COLORS.bgLight,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(classDef.tabs).sort(([a], [b]) => Number(a) - Number(b)).flatMap(([tabIdxStr, tab]) =>
                  Object.entries(tab.talents)
                    .sort(([, a], [, b]) => a.row !== b.row ? a.row - b.row : a.col - b.col)
                    .map(([tidStr, t]) => {
                      const tid = Number(tidStr);
                      const isActive = selectedTalentId === tid && selectedTabIdx === Number(tabIdxStr);
                      return (
                        <tr key={`${tabIdxStr}-${tid}`}
                          onClick={() => selectTalent(Number(tabIdxStr), tid)}
                          style={{ cursor: 'pointer', background: isActive ? classColor + '22' : 'transparent' }}>
                          <td style={tdStyle}>{tid}</td>
                          <td style={tdStyle}>{tab.name}</td>
                          <td style={tdStyle}>{t.row}</td>
                          <td style={tdStyle}>{t.col}</td>
                          <td style={tdStyle}>{t.maxRank}</td>
                          <td style={tdStyle}>{t.spells?.[0] || '-'}</td>
                          <td style={tdStyle}>{t.prereqs?.[0]?.id || '-'}</td>
                          <td style={tdStyle}>{t.flags ? `0x${(t.flags >>> 0).toString(16).toUpperCase()}` : '-'}</td>
                          <td style={tdStyle}>{t.mastery ? '★' : '-'}</td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  Sub-components
 * ────────────────────────────────────────────────────────────────── */

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: COLORS.textDim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function LabeledInput({ label, value, onChange, disabled }: {
  label: string; value: string | number; onChange?: (val: string | number) => void; disabled?: boolean;
}) {
  return (
    <div>
      <label style={{ fontSize: 9, color: COLORS.textDim, display: 'block' }}>{label}</label>
      <input value={value} onChange={e => onChange?.(e.target.value)} disabled={disabled}
        style={{
          width: '100%', padding: '3px 6px',
          background: disabled ? COLORS.bgHover : COLORS.bg,
          color: disabled ? COLORS.textDim : COLORS.text,
          border: `1px solid ${COLORS.border}`, borderRadius: 4,
          fontSize: 12, boxSizing: 'border-box', outline: 'none',
        }} />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 *  Styles
 * ────────────────────────────────────────────────────────────────── */

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '6px 14px', background: color + '22', color,
    border: `1px solid ${color}55`, borderRadius: 6,
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
  };
}

const smallBtnStyle: React.CSSProperties = {
  padding: '2px 8px', background: 'transparent', color: COLORS.textDim,
  border: `1px solid ${COLORS.border}`, borderRadius: 4,
  cursor: 'pointer', fontSize: 10,
};

const tdStyle: React.CSSProperties = {
  padding: '3px 8px', borderBottom: `1px solid ${COLORS.border}`, color: COLORS.text,
};
