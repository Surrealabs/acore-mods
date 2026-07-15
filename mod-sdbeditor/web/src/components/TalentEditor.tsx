import React, { useCallback, useEffect, useMemo, useState } from 'react';

/*
 * TalentEditor - simplified JSON-driven editor
 * - No DBC usage
 * - Uses spell IDs (icons from Spell.dbc index)
 * - Supports drag/drop layout, prereqs, max rank, and editable specs
 */

interface TalentPrereq {
  id: number;
  rank: number;
}

interface TalentDef {
  id: number;
  row: number;
  col: number;
  maxRank: number;
  spells: number[];
  prereqs?: TalentPrereq[];
  flags?: number;
  mastery?: boolean;
}

interface TreeDef {
  rows: number;
  cols: number;
  talents: TalentDef[];
}

interface SpecDef {
  name: string;
  rows: number;
  cols: number;
  talents: TalentDef[];
  heroTrees?: TreeDef[];
}

interface ClassDef {
  className: string;
  specs: SpecDef[];
  classTree?: TreeDef;
}

type TalentZone = { type: 'class' | 'spec' | 'hero'; heroIdx?: number };

interface DraftTalent {
  talent: TalentDef;
  target: TalentZone;
}

interface TalentConfig {
  classes: Record<number, ClassDef>;
}

type TalentEditorProps = {
  textColor?: string;
  contentBoxColor?: string;
};

const CLASS_NAMES: Record<number, string> = {
  1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest',
  6: 'Death Knight', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 11: 'Druid',
};

const CLASS_COLORS: Record<number, string> = {
  1: '#C79C6E', 2: '#F58CBA', 3: '#ABD473', 4: '#FFF569', 5: '#FFFFFF',
  6: '#C41F3B', 7: '#0070DE', 8: '#69CCF0', 9: '#9482C9', 11: '#FF7D0A',
};

const C = {
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
  gold: '#ffd100',
};

const CLASS_TREE_COLOR = '#39d2c0';
const HERO1_COLOR = '#f778ba';
const HERO2_COLOR = '#bc8cff';

const DEFAULT_ROWS = 11;
const DEFAULT_COLS = 7;
const MAX_SPECS = 5;
const MAX_GRID = 22;
const CELL_SIZE = 48;
const CELL_GAP = 3;
const SIDE_TREE_COLS = 3;
const SIDE_TREE_ROWS = 5;
const SPEC_COL_START = 3;  // spec grid starts at global col 4
const HERO2_ROW_START = 5;

const btnStyle = (color: string): React.CSSProperties => ({
  padding: '6px 12px',
  background: 'transparent',
  color,
  border: `1px solid ${color}55`,
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
});

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: 'transparent',
  color: C.textDim,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
};

const inputStyle: React.CSSProperties = {
  width: 60,
  background: C.bg,
  border: `1px solid ${C.border}`,
  color: C.text,
  padding: '4px 6px',
  borderRadius: 6,
  fontSize: 12,
};

const blankSpec = (name: string): SpecDef => ({
  name,
  rows: DEFAULT_ROWS,
  cols: DEFAULT_COLS,
  talents: [],
  heroTrees: [
    { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] },
    { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] },
  ],
});

const normalizeTalents = (list: any[]): TalentDef[] => (
  list.map((t) => ({
    id: Number(t.id),
    row: Number(t.row || 1),
    col: Number(t.col || 1),
    maxRank: Number(t.maxRank || (t.spells?.length || 0)),
    spells: Array.isArray(t.spells) ? t.spells.map(Number) : [],
    prereqs: Array.isArray(t.prereqs) ? t.prereqs.map((p: any) => ({ id: Number(p.id), rank: Number(p.rank || 0) })) : undefined,
    flags: t.flags,
    mastery: !!t.mastery,
  }))
);

const normalizeTree = (tree: any, fallbackRows: number, fallbackCols: number): TreeDef => ({
  rows: Math.min(MAX_GRID, Math.max(1, Number(tree?.rows || fallbackRows))),
  cols: Math.min(MAX_GRID, Math.max(1, Number(tree?.cols || fallbackCols))),
  talents: normalizeTalents(Array.isArray(tree?.talents) ? tree.talents : []),
});

const normalizeConfig = (raw: TalentConfig | null): TalentConfig => {
  const classes: Record<number, ClassDef> = {};
  const src = (raw?.classes || {}) as Record<number, any>;

  for (const [idStr, className] of Object.entries(CLASS_NAMES)) {
    const id = Number(idStr);
    const existing = src[id];
    if (existing && existing.tabs && typeof existing.tabs === 'object') {
      const tabKeys = Object.keys(existing.tabs)
        .map((k) => Number(k))
        .filter((k) => Number.isFinite(k))
        .sort((a, b) => a - b);

      const specs = tabKeys.map((tabKey: number, idx: number) => {
        const tab = existing.tabs[tabKey] || {};
        const talentsObj = tab.talents || {};
        const talents = Object.entries(talentsObj)
          .map(([talentId, t]: [string, any]) => ({
            id: Number(talentId),
            row: Number(t?.row || 1),
            col: Number(t?.col || 1),
            maxRank: Number(t?.maxRank || (Array.isArray(t?.spells) ? t.spells.length : 1)),
            spells: Array.isArray(t?.spells) ? t.spells.map(Number) : [],
            prereqs: Array.isArray(t?.prereqs)
              ? t.prereqs.map((p: any) => ({ id: Number(p?.id || 0), rank: Number(p?.rank || 0) }))
              : undefined,
            flags: t?.flags,
            mastery: !!t?.mastery,
          }))
          .filter((t: TalentDef) => Number.isFinite(t.id) && t.id > 0);

        return {
          name: tab.name || `Spec ${idx + 1}`,
          rows: DEFAULT_ROWS,
          cols: DEFAULT_COLS,
          talents,
          heroTrees: [
            { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] },
            { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] },
          ],
        };
      });

      classes[id] = {
        className: existing.className || className,
        classTree: { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] },
        specs,
      };
      continue;
    }

    if (existing && Array.isArray(existing.specs)) {
      const classTree = existing.classTree
        ? normalizeTree(existing.classTree, SIDE_TREE_ROWS, SIDE_TREE_COLS)
        : { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] };

      const classTreeIds = new Set<number>(classTree.talents.map(t => t.id));

      const specs = existing.specs.map((s: any, idx: number) => {
        const baseRows = Math.min(MAX_GRID, Math.max(1, s.rows || DEFAULT_ROWS));
        const baseCols = Math.min(MAX_GRID, Math.max(1, s.cols || DEFAULT_COLS));
        const rawTalents = normalizeTalents(Array.isArray(s.talents) ? s.talents : []);

        const hasHeroTrees = Array.isArray(s.heroTrees);
        if (!hasHeroTrees && rawTalents.length > 0) {
          const heroColStart = SPEC_COL_START + baseCols;
          const specTalents: TalentDef[] = [];
          const hero1: TalentDef[] = [];
          const hero2: TalentDef[] = [];

          for (const t of rawTalents) {
            if (t.row <= SIDE_TREE_ROWS && t.col <= SIDE_TREE_COLS) {
              if (!classTreeIds.has(t.id)) {
                classTree.talents.push({ ...t, row: t.row, col: t.col });
                classTreeIds.add(t.id);
              }
              continue;
            }

            if (t.col >= SPEC_COL_START + 1 && t.col <= SPEC_COL_START + baseCols) {
              specTalents.push({ ...t, col: t.col - SPEC_COL_START });
              continue;
            }

            if (t.col >= heroColStart + 1 && t.col <= heroColStart + SIDE_TREE_COLS) {
              if (t.row >= 1 && t.row <= SIDE_TREE_ROWS) {
                hero1.push({ ...t, col: t.col - heroColStart });
                continue;
              }
              if (t.row >= HERO2_ROW_START + 1 && t.row <= HERO2_ROW_START + SIDE_TREE_ROWS) {
                hero2.push({ ...t, row: t.row - HERO2_ROW_START, col: t.col - heroColStart });
                continue;
              }
            }

            specTalents.push({ ...t, col: Math.max(1, t.col - SPEC_COL_START) });
          }

          return {
            name: s.name || `Spec ${idx + 1}`,
            rows: baseRows,
            cols: baseCols,
            talents: specTalents,
            heroTrees: [
              { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: hero1 },
              { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: hero2 },
            ],
          };
        }

        return {
          name: s.name || `Spec ${idx + 1}`,
          rows: baseRows,
          cols: baseCols,
          talents: rawTalents,
          heroTrees: hasHeroTrees
            ? s.heroTrees.map((h: any) => normalizeTree(h, SIDE_TREE_ROWS, SIDE_TREE_COLS))
            : [
                { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] },
                { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] },
              ],
        };
      });

      classes[id] = {
        className: existing.className || className,
        classTree,
        specs,
      };
      continue;
    }

    classes[id] = {
      className,
      classTree: { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] },
      specs: [blankSpec('Spec 1'), blankSpec('Spec 2'), blankSpec('Spec 3'), blankSpec('Spec 4'), blankSpec('Spec 5')],
    };
  }

  return { classes };
};

export default function TalentEditor(_props: TalentEditorProps) {
  const [config, setConfig] = useState<TalentConfig>({ classes: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedClass, setSelectedClass] = useState<number>(9);
  const [activeSpecIdx, setActiveSpecIdx] = useState(0);
  const [selectedTalentId, setSelectedTalentId] = useState<number | null>(null);
  const [newTalentDraft, setNewTalentDraft] = useState<DraftTalent | null>(null);
  const [dragTalentId, setDragTalentId] = useState<number | null>(null);
  const [dragSource, setDragSource] = useState<TalentZone | null>(null);
  const [activeHeroIdx, setActiveHeroIdx] = useState(0);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [spellIconIndex, setSpellIconIndex] = useState<Record<string, string>>({});
  const [spellLookupId, setSpellLookupId] = useState<number>(0);
  const [spellSearch, setSpellSearch] = useState('');
  const [spellResults, setSpellResults] = useState<Array<{ id: number; name: string; icon?: string | null }>>([]);

  // Load spell icon index for Spell.dbc icons
  useEffect(() => {
    fetch('/api/spell-icon-index?full=true')
      .then(r => r.ok ? r.json() : { index: {} })
      .then(data => { if (data.index) setSpellIconIndex(data.index); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!spellSearch || spellSearch.trim().length < 2) {
      setSpellResults([]);
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/spell-search?q=${encodeURIComponent(spellSearch.trim())}&limit=50`, { signal: controller.signal });
        const data = await res.json();
        if (res.ok && Array.isArray(data.results)) setSpellResults(data.results);
      } catch { /* ignore */ }
    }, 250);

    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [spellSearch]);

  const getSpellIconUrl = (spellId: number): string | null => {
    if (!spellId) return null;
    const iconName = spellIconIndex[spellId];
    if (!iconName) return null;
    return `/thumbnails/${iconName}.png`;
  };

  const applySpellToRank1 = (spellId: number) => {
    if (!displayedTalent) return;
    const adjust = (t: TalentDef) => {
      const spells = [...(t.spells || [])];
      spells[0] = spellId;
      const maxRank = Math.max(t.maxRank || 0, 1);
      return { ...t, spells, maxRank };
    };
    newTalentDraft ? updateDraft(adjust) : updateTalent(displayedTalent.id, adjust);
  };

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/talent-config');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load config');
      setConfig(normalizeConfig(data));
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const classConfig = config.classes[selectedClass] || { className: CLASS_NAMES[selectedClass], specs: [] };
  const specs = classConfig.specs || [];
  const currentSpec = specs[activeSpecIdx] || specs[0];
  const classTree = classConfig.classTree || { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] };
  const heroTrees = currentSpec?.heroTrees || [
    { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] },
    { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] },
  ];

  useEffect(() => {
    if (!currentSpec && specs.length > 0) setActiveSpecIdx(0);
  }, [currentSpec, specs.length]);

  const setClassConfig = (classId: number, updater: (cls: ClassDef) => ClassDef) => {
    setConfig(prev => {
      const cls = prev.classes[classId] || { className: CLASS_NAMES[classId], specs: [] };
      return { ...prev, classes: { ...prev.classes, [classId]: updater(cls) } };
    });
  };

  const setSpec = (specIdx: number, updater: (spec: SpecDef) => SpecDef) => {
    setClassConfig(selectedClass, (cls) => {
      const nextSpecs = [...(cls.specs || [])];
      const base = nextSpecs[specIdx] || blankSpec(`Spec ${specIdx + 1}`);
      nextSpecs[specIdx] = updater(base);
      return { ...cls, specs: nextSpecs };
    });
  };

  const getNextTalentId = (cls: ClassDef): number => {
    let maxId = 0;
    for (const s of cls.specs) {
      for (const t of s.talents) maxId = Math.max(maxId, t.id);
      for (const h of (s.heroTrees || [])) {
        for (const t of h.talents) maxId = Math.max(maxId, t.id);
      }
    }
    for (const t of (cls.classTree?.talents || [])) maxId = Math.max(maxId, t.id);
    return maxId + 1;
  };

  const setStatus = (msg: string) => setStatusMsg(msg);

  const setClassTree = (updater: (tree: TreeDef) => TreeDef) => {
    setClassConfig(selectedClass, (cls) => ({
      ...cls,
      classTree: updater(cls.classTree || { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] }),
    }));
  };

  const setHeroTree = (specIdx: number, heroIdx: number, updater: (tree: TreeDef) => TreeDef) => {
    setSpec(specIdx, (spec) => {
      const heroes = [...(spec.heroTrees || [
        { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] },
        { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] },
      ])];
      heroes[heroIdx] = updater(heroes[heroIdx] || { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] });
      return { ...spec, heroTrees: heroes };
    });
  };

  const findTalentLocation = (talentId: number): (TalentZone & { talent: TalentDef }) | null => {
    const classMatch = classTree.talents.find(t => t.id === talentId);
    if (classMatch) return { type: 'class', talent: classMatch };

    if (currentSpec) {
      const specMatch = currentSpec.talents.find(t => t.id === talentId);
      if (specMatch) return { type: 'spec', talent: specMatch };
      for (let i = 0; i < heroTrees.length; i++) {
        const heroMatch = heroTrees[i]?.talents.find(t => t.id === talentId);
        if (heroMatch) return { type: 'hero', heroIdx: i, talent: heroMatch };
      }
    }

    return null;
  };

  // Drag and drop
  const handleDragStart = (talentId: number, source: TalentZone) => {
    setDragTalentId(talentId);
    setDragSource(source);
  };

  const handleDrop = (row: number, col: number, target: TalentZone) => {
    if (dragTalentId === null || !dragSource) return;
    if (dragSource.type !== target.type) return;
    if (dragSource.type === 'hero' && dragSource.heroIdx !== target.heroIdx) return;

    const getPool = (): TalentDef[] => {
      if (target.type === 'class') return classTree.talents;
      if (target.type === 'spec') return currentSpec?.talents || [];
      return heroTrees[target.heroIdx || 0]?.talents || [];
    };

    const pool = getPool();
    const occupant = pool.find(t => t.row === row && t.col === col);
    if (occupant && occupant.id !== dragTalentId) {
      setStatus(`Cell (${row}, ${col}) occupied by #${occupant.id}`);
      setDragTalentId(null);
      setDragSource(null);
      return;
    }

    if (target.type === 'class') {
      setClassTree((tree) => ({
        ...tree,
        talents: tree.talents.map(t => t.id === dragTalentId ? { ...t, row, col } : t),
      }));
    } else if (target.type === 'spec') {
      setSpec(activeSpecIdx, (spec) => ({
        ...spec,
        talents: spec.talents.map(t => t.id === dragTalentId ? { ...t, row, col } : t),
      }));
    } else {
      setHeroTree(activeSpecIdx, target.heroIdx || 0, (tree) => ({
        ...tree,
        talents: tree.talents.map(t => t.id === dragTalentId ? { ...t, row, col } : t),
      }));
    }

    setDragTalentId(null);
    setDragSource(null);
    setStatusMsg(null);
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  // Talent operations
  const openNewTalent = (row: number, col: number, target: TalentZone) => {
    const newTalent: TalentDef = {
      id: -1,
      row,
      col,
      maxRank: 0,
      spells: [],
      prereqs: [],
      flags: 0,
      mastery: false,
    };
    setNewTalentDraft({ talent: newTalent, target });
    setSelectedTalentId(null);
  };

  const commitNewTalent = () => {
    if (!newTalentDraft) return;
    const newId = getNextTalentId(classConfig);
    const talent = { ...newTalentDraft.talent, id: newId };
    const target = newTalentDraft.target;

    if (target.type === 'class') {
      setClassTree((tree) => ({ ...tree, talents: [...tree.talents, talent] }));
    } else if (target.type === 'spec') {
      setSpec(activeSpecIdx, (spec) => ({
        ...spec,
        talents: [...spec.talents, talent],
      }));
    } else {
      setHeroTree(activeSpecIdx, target.heroIdx || 0, (tree) => ({
        ...tree,
        talents: [...tree.talents, talent],
      }));
    }

    setNewTalentDraft(null);
    setSelectedTalentId(newId);
  };

  const deleteTalent = (talentId: number) => {
    const loc = findTalentLocation(talentId);
    if (!loc) return;
    if (!confirm(`Delete talent #${talentId}?`)) return;
    if (loc.type === 'class') {
      setClassTree((tree) => ({ ...tree, talents: tree.talents.filter(t => t.id !== talentId) }));
    } else if (loc.type === 'spec') {
      setSpec(activeSpecIdx, (spec) => ({
        ...spec,
        talents: spec.talents.filter(t => t.id !== talentId),
      }));
    } else {
      setHeroTree(activeSpecIdx, loc.heroIdx || 0, (tree) => ({
        ...tree,
        talents: tree.talents.filter(t => t.id !== talentId),
      }));
    }
    setSelectedTalentId(null);
  };

  const updateTalent = (talentId: number, updater: (t: TalentDef) => TalentDef) => {
    const loc = findTalentLocation(talentId);
    if (!loc) return;
    if (loc.type === 'class') {
      setClassTree((tree) => ({
        ...tree,
        talents: tree.talents.map(t => t.id === talentId ? updater(t) : t),
      }));
    } else if (loc.type === 'spec') {
      setSpec(activeSpecIdx, (spec) => ({
        ...spec,
        talents: spec.talents.map(t => t.id === talentId ? updater(t) : t),
      }));
    } else {
      setHeroTree(activeSpecIdx, loc.heroIdx || 0, (tree) => ({
        ...tree,
        talents: tree.talents.map(t => t.id === talentId ? updater(t) : t),
      }));
    }
  };

  const updateDraft = (updater: (t: TalentDef) => TalentDef) => {
    setNewTalentDraft(prev => prev ? { ...prev, talent: updater(prev.talent) } : prev);
  };

  const selectedLocation = useMemo(() => {
    if (selectedTalentId === null) return null;
    return findTalentLocation(selectedTalentId);
  }, [selectedTalentId, classTree, currentSpec, heroTrees]);

  const displayedTalent = useMemo(() => {
    if (newTalentDraft) return newTalentDraft.talent;
    return selectedLocation?.talent || null;
  }, [newTalentDraft, selectedLocation]);

  const masteryEditable = newTalentDraft
    ? newTalentDraft.target.type === 'spec'
    : selectedLocation?.type === 'spec';

  const allCurrentTalents = currentSpec?.talents || [];

  const masteryId = useMemo(() => {
    const mastery = allCurrentTalents.find(t => t.mastery);
    return mastery ? mastery.id : null;
  }, [allCurrentTalents]);

  const isMastery = (t: TalentDef) => !!t.mastery;

  const specTalents = allCurrentTalents.filter(t =>
    t.row >= 1 && t.row <= (currentSpec?.rows || DEFAULT_ROWS)
    && t.col >= 1 && t.col <= (currentSpec?.cols || DEFAULT_COLS)
    && !isMastery(t)
  );

  const classZoneTalents = classTree.talents.filter(t =>
    t.row >= 1 && t.row <= SIDE_TREE_ROWS
    && t.col >= 1 && t.col <= SIDE_TREE_COLS
    && !isMastery(t)
  );

  const activeHeroTree = heroTrees[activeHeroIdx] || { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] };
  const heroZoneTalents = activeHeroTree.talents.filter(t =>
    t.row >= 1 && t.row <= SIDE_TREE_ROWS
    && t.col >= 1 && t.col <= SIDE_TREE_COLS
    && !isMastery(t)
  );

  // Spec management
  const addSpec = () => {
    if (specs.length >= MAX_SPECS) {
      setStatus(`Maximum ${MAX_SPECS} specs per class reached`);
      return;
    }
    setClassConfig(selectedClass, (cls) => ({
      ...cls,
      specs: [...cls.specs, blankSpec(`Spec ${cls.specs.length + 1}`)],
    }));
    setActiveSpecIdx(specs.length);
    setActiveHeroIdx(0);
  };

  const removeSpec = (idx: number) => {
    if (specs.length <= 1) {
      setStatus('At least one spec is required');
      return;
    }
    if (!confirm('Remove this spec and all its talents?')) return;
    setClassConfig(selectedClass, (cls) => {
      const next = cls.specs.filter((_, i) => i !== idx);
      return { ...cls, specs: next };
    });
    setActiveSpecIdx(0);
    setActiveHeroIdx(0);
    setSelectedTalentId(null);
  };

  const moveSpec = (from: number, to: number) => {
    if (to < 0 || to >= specs.length) return;
    setClassConfig(selectedClass, (cls) => {
      const next = [...cls.specs];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...cls, specs: next };
    });
    setActiveSpecIdx(to);
    setActiveHeroIdx(0);
  };

  const spreadTalents = () => {
    const spreadList = (talents: TalentDef[], cols: number, rows: number): TalentDef[] => {
      if (!Array.isArray(talents) || talents.length === 0) return talents || [];
      const safeCols = Math.max(1, cols);
      const safeRows = Math.max(1, rows);
      const perPage = safeCols * safeRows;
      const ordered = [...talents].sort((a, b) => (a.row - b.row) || (a.col - b.col) || (a.id - b.id));

      return ordered.map((talent, idx) => {
        const page = Math.floor(idx / perPage);
        const slot = idx % perPage;
        return {
          ...talent,
          row: Math.floor(slot / safeCols) + 1 + (page * safeRows),
          col: (slot % safeCols) + 1,
        };
      });
    };

    setClassConfig(selectedClass, (cls) => {
      const nextSpecs = [...(cls.specs || [])];
      const current = nextSpecs[activeSpecIdx] || blankSpec(`Spec ${activeSpecIdx + 1}`);
      nextSpecs[activeSpecIdx] = {
        ...current,
        talents: spreadList(current.talents || [], Math.max(1, Number(current.cols || DEFAULT_COLS)), Math.max(1, Number(current.rows || DEFAULT_ROWS))),
        heroTrees: [
          {
            ...(current.heroTrees?.[0] || { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] }),
            talents: spreadList(current.heroTrees?.[0]?.talents || [], SIDE_TREE_COLS, SIDE_TREE_ROWS),
          },
          {
            ...(current.heroTrees?.[1] || { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] }),
            talents: spreadList(current.heroTrees?.[1]?.talents || [], SIDE_TREE_COLS, SIDE_TREE_ROWS),
          },
        ],
      };

      return {
        ...cls,
        classTree: {
          ...(cls.classTree || { rows: SIDE_TREE_ROWS, cols: SIDE_TREE_COLS, talents: [] }),
          talents: spreadList(cls.classTree?.talents || [], SIDE_TREE_COLS, SIDE_TREE_ROWS),
        },
        specs: nextSpecs,
      };
    });

    setStatus('Spread talents across class/spec/hero grids for overlap checking');
  };

  // Save + deploy
  const saveConfig = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/talent-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config, null, 2),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Save failed');
      setStatus('Saved talent config');
    } catch (err: any) {
      setStatus(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const deployToServer = async () => {
    try {
      setStatus('Deploying talent config to server...');
      const res = await fetch('/api/talent-config/deploy', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || `Server returned ${res.status}`);
      setStatus(`Deployed! ${result.talents} talents across ${result.classes} classes -> ${result.luaPath}`);
    } catch (err: any) {
      setStatus(`Deploy failed: ${err.message}`);
    }
  };

  const syncDbcFromServer = async () => {
    try {
      setStatus('Syncing DBC files from worldserver...');
      const res = await fetch('/api/import-server-dbc', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || `Server returned ${res.status}`);
      const iconCount = result.spellIconEntries || 0;
      const nameCount = result.spellNameEntries || 0;
      setStatus(`Synced DBCs (${result.imported?.length || 0} updated) — icons ${iconCount}, names ${nameCount}`);
      const refresh = await fetch('/api/spell-icon-index?full=true');
      const data = await refresh.json();
      if (refresh.ok && data.index) setSpellIconIndex(data.index);
    } catch (err: any) {
      setStatus(`DBC sync failed: ${err.message}`);
    }
  };

  const importFromDbc = async () => {
    try {
      setStatus('Importing talent data from Talent.dbc...');
      const res = await fetch('/api/talent-config/import-dbc', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || `Server returned ${res.status}`);
      setStatus(`Imported ${result.imported || 0} talents from DBC into talent-config.json`);
      await loadConfig();
    } catch (err: any) {
      setStatus(`Import failed: ${err.message}`);
    }
  };

  if (loading) return <div style={{ padding: 24, color: C.accent }}>Loading talent data...</div>;
  if (error) return <div style={{ padding: 24, color: C.red }}>Error: {error}</div>;

  const classColor = CLASS_COLORS[selectedClass] || C.text;

  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", color: C.text }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0',
        borderBottom: `1px solid ${C.border}`, marginBottom: 16, flexWrap: 'wrap',
      }}>
        <h3 style={{ margin: 0, color: C.textBright }}>Talent Editor</h3>
        <span style={{ color: C.textDim, fontSize: 12 }}>
          Drag to reposition · Click to edit · JSON-based
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={saveConfig} disabled={saving} style={btnStyle(C.green)}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={deployToServer} style={btnStyle('#e68a00')}>
          Deploy to Server
        </button>
        <button onClick={syncDbcFromServer} style={btnStyle('#4a9')}>
          Sync DBCs
        </button>
        <button onClick={importFromDbc} style={btnStyle('#5c7cfa')}>
          Import DBC → JSON
        </button>
        <button onClick={() => loadConfig()} style={btnStyle('#888')}>
          Reload
        </button>
      </div>

      {/* Status */}
      {statusMsg && (
        <div style={{
          padding: '6px 12px', marginBottom: 12, fontSize: 12, borderRadius: 6,
          color: statusMsg.toLowerCase().includes('fail') ? C.red : C.green,
          background: statusMsg.toLowerCase().includes('fail') ? '#2d1418' : '#0d2818',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{statusMsg}</span>
          <button onClick={() => setStatusMsg(null)} style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer' }}>x</button>
        </div>
      )}

      {/* Class selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {Object.entries(CLASS_NAMES).map(([id, name]) => {
          const cid = Number(id);
          const isActive = cid === selectedClass;
          return (
            <button key={id}
              onClick={() => { setSelectedClass(cid); setActiveSpecIdx(0); setActiveHeroIdx(0); setSelectedTalentId(null); setNewTalentDraft(null); }}
              style={{
                padding: '6px 14px',
                background: isActive ? (CLASS_COLORS[cid] || C.accent) + '33' : 'transparent',
                color: CLASS_COLORS[cid] || C.text,
                border: `1px solid ${isActive ? (CLASS_COLORS[cid] || C.accent) : C.border}`,
                borderRadius: 6, cursor: 'pointer', fontSize: 12,
                fontWeight: isActive ? 700 : 400,
              }}
            >{name}</button>
          );
        })}
      </div>

      {/* Spec tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {specs.map((spec, idx) => {
          const isActive = idx === activeSpecIdx;
          return (
            <div key={`${spec.name}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                onClick={() => { setActiveSpecIdx(idx); setActiveHeroIdx(0); setSelectedTalentId(null); setNewTalentDraft(null); }}
                style={{
                  padding: '8px 16px',
                  background: isActive ? classColor + '33' : C.bgLight,
                  color: isActive ? classColor : C.textDim,
                  border: `1px solid ${isActive ? classColor : C.border}`,
                  borderBottom: isActive ? `2px solid ${classColor}` : '1px solid transparent',
                  borderRadius: '6px 6px 0 0', cursor: 'pointer',
                  fontSize: 13, fontWeight: isActive ? 700 : 400,
                }}
              >
                {spec.name} <span style={{ fontSize: 10, marginLeft: 6, color: C.textDim }}>({spec.talents.length})</span>
              </button>
              <button onClick={() => moveSpec(idx, idx - 1)} style={smallBtnStyle} title="Move left">◀</button>
              <button onClick={() => moveSpec(idx, idx + 1)} style={smallBtnStyle} title="Move right">▶</button>
              <button onClick={() => removeSpec(idx)} style={{ ...smallBtnStyle, color: C.red, borderColor: C.red + '55' }} title="Remove spec">✕</button>
            </div>
          );
        })}
        <button
          onClick={addSpec}
          disabled={specs.length >= MAX_SPECS}
          style={{ ...smallBtnStyle, color: C.green, borderColor: C.green + '55', opacity: specs.length >= MAX_SPECS ? 0.5 : 1 }}
          title={specs.length >= MAX_SPECS ? `Max ${MAX_SPECS} specs` : 'Add spec'}
        >+ Add Spec</button>
        <span style={{ fontSize: 11, color: C.textDim }}>Specs: {specs.length}/{MAX_SPECS}</span>
      </div>

      {/* Spec controls */}
      {currentSpec && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 12, color: C.textDim }}>Spec name:</label>
            <input
              value={currentSpec.name}
              onChange={e => setSpec(activeSpecIdx, spec => ({ ...spec, name: e.target.value }))}
              style={{ ...inputStyle, width: 160 }}
            />
            <label style={{ fontSize: 12, color: C.textDim }}>Rows:</label>
            <input type="number" min={1} max={MAX_GRID} value={currentSpec.rows}
              onChange={e => setSpec(activeSpecIdx, spec => ({ ...spec, rows: Math.min(MAX_GRID, Math.max(1, Number(e.target.value))) }))}
              style={inputStyle} />
            <label style={{ fontSize: 12, color: C.textDim }}>Cols:</label>
            <input type="number" min={1} max={MAX_GRID} value={currentSpec.cols}
              onChange={e => setSpec(activeSpecIdx, spec => ({ ...spec, cols: Math.min(MAX_GRID, Math.max(1, Number(e.target.value))) }))}
              style={inputStyle} />
          </div>
          <button
            onClick={spreadTalents}
            style={{ ...smallBtnStyle, color: C.yellow, borderColor: C.yellow + '55' }}
            title="Spread talents to unique cells"
          >
            Spread Talents
          </button>
        </div>
      )}

      {/* Main content */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* LEFT: Class Tree + Mastery */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}>
          {/* Class Tree */}
          <div style={{
            width: SIDE_TREE_COLS * (CELL_SIZE + CELL_GAP) - CELL_GAP + 32,
            background: C.bgLight, border: `1px solid ${CLASS_TREE_COLOR}33`,
            borderRadius: 8, padding: 12,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              color: CLASS_TREE_COLOR, letterSpacing: 1, textAlign: 'center',
              marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid rgba(57,210,192,0.2)',
            }}>
              Class Tree ({classZoneTalents.length})
            </div>
            {Array.from({ length: SIDE_TREE_ROWS }, (_, r) => {
              const row1 = r + 1;
              return (
                <div key={r} style={{ display: 'flex', gap: CELL_GAP, marginBottom: CELL_GAP, justifyContent: 'center' }}>
                  {Array.from({ length: SIDE_TREE_COLS }, (_, c) => {
                    const col1 = c + 1;
                    const centerCol = 2;
                    const isCorner = (row1 === 1 || row1 === SIDE_TREE_ROWS) && col1 !== centerCol;
                    if (isCorner) return <div key={c} style={{ width: CELL_SIZE, height: CELL_SIZE }} />;

                    const talent = classZoneTalents.find(t => t.row === row1 && t.col === col1);
                    const isSelected = talent && selectedTalentId === talent.id;
                    if (talent) {
                      const iconUrl = getSpellIconUrl(talent.spells[0] || 0);
                      return (
                        <div key={c} draggable onDragStart={() => handleDragStart(talent.id, { type: 'class' })}
                          onDragOver={handleDragOver} onDrop={() => handleDrop(row1, col1, { type: 'class' })}
                          onClick={() => { setSelectedTalentId(talent.id); setNewTalentDraft(null); }}
                          style={{
                            width: CELL_SIZE, height: CELL_SIZE,
                            border: `2px solid ${isSelected ? C.gold : CLASS_TREE_COLOR}`,
                            borderRadius: 6, cursor: 'grab', position: 'relative',
                            userSelect: 'none', overflow: 'hidden', background: C.bg,
                          }}
                          title={`#${talent.id} - Spell ${talent.spells[0] || 0}`}
                        >
                          {iconUrl ? (
                            <img src={iconUrl} alt="" style={{ width: '100%', height: '100%' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDim }}>?</div>
                          )}
                          <span style={{
                            position: 'absolute', bottom: 1, right: 2,
                            fontSize: 9, fontWeight: 700, color: '#fff',
                            textShadow: '0 0 3px #000, 0 0 3px #000', lineHeight: 1,
                          }}>#{talent.id}</span>
                        </div>
                      );
                    }

                    return (
                      <div key={c}
                        onDragOver={handleDragOver} onDrop={() => handleDrop(row1, col1, { type: 'class' })}
                        onClick={() => openNewTalent(row1, col1, { type: 'class' })}
                        style={{
                          width: CELL_SIZE, height: CELL_SIZE,
                          border: `1px dashed ${dragTalentId ? C.accent + '66' : C.border}`,
                          borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 14, color: C.border + '88', cursor: 'pointer',
                        }}
                      >
                        {dragTalentId ? 'v' : '+'}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Mastery Panel */}
          {(() => {
            if (!masteryId) return null;
            const mastery = allCurrentTalents.find(t => t.id === masteryId);
            if (!mastery) return null;
            const iconUrl = getSpellIconUrl(mastery.spells[0] || 0);
            const isSelected = selectedTalentId === mastery.id;
            return (
              <div style={{
                width: SIDE_TREE_COLS * (CELL_SIZE + CELL_GAP) - CELL_GAP + 32,
                background: C.bgLight, border: `1px solid rgba(255,209,0,0.25)`,
                borderRadius: 8, padding: 12,
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  color: C.gold, letterSpacing: 1, textAlign: 'center',
                  marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid rgba(255,209,0,0.2)',
                }}>
                  Mastery
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                  <div
                    onClick={() => { setSelectedTalentId(mastery.id); setNewTalentDraft(null); }}
                    style={{
                      width: CELL_SIZE, height: CELL_SIZE,
                      border: `2px solid ${isSelected ? C.gold : 'rgba(255,209,0,0.5)'}`,
                      borderRadius: 6, cursor: 'pointer', position: 'relative',
                      overflow: 'hidden', flexShrink: 0,
                      boxShadow: isSelected ? `0 0 8px ${C.gold}66` : '0 0 6px rgba(255,209,0,0.15)',
                    }}
                    title={`Mastery #${mastery.id} - Spell ${mastery.spells[0] || 0}`}
                  >
                    {iconUrl ? (
                      <img src={iconUrl} alt="" style={{ width: '100%', height: '100%' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDim }}>?</div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: C.text, lineHeight: 1.3 }}>
                    <div style={{ fontWeight: 700, color: C.gold, marginBottom: 2 }}>ID {mastery.id}</div>
                    <div style={{ color: C.textDim, fontSize: 10 }}>Spell {mastery.spells[0] || 0}</div>
                    <div style={{ color: C.textDim, fontSize: 10 }}>{currentSpec?.name}</div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Grid */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            background: C.bgLight,
            border: `1px solid ${C.border}`,
            borderRadius: 8, padding: 16, overflowX: 'auto',
          }}>
            {/* Column headers */}
            <div style={{ display: 'flex', gap: CELL_GAP, marginBottom: 4, paddingLeft: 32 }}>
              {Array.from({ length: currentSpec?.cols || DEFAULT_COLS }, (_, c) => (
                <div key={c} style={{ width: CELL_SIZE, textAlign: 'center', fontSize: 10, color: C.textDim, fontWeight: 600 }}>
                  C{c + 1}
                </div>
              ))}
            </div>

            {Array.from({ length: currentSpec?.rows || DEFAULT_ROWS }, (_, rowIdx) => {
              const row1 = rowIdx + 1;
              return (
                <div key={rowIdx} style={{ display: 'flex', gap: CELL_GAP, marginBottom: CELL_GAP, alignItems: 'center' }}>
                  <div style={{ width: 28, textAlign: 'right', fontSize: 10, color: C.textDim, fontWeight: 600, paddingRight: 4 }}>
                    R{row1}
                  </div>
                  {Array.from({ length: currentSpec?.cols || DEFAULT_COLS }, (_, colIdx) => {
                    const col1 = colIdx + 1;
                    const talent = specTalents.find(t => t.row === row1 && t.col === col1);
                    const isSelected = talent && selectedTalentId === talent.id;

                    if (talent) {
                      const iconUrl = getSpellIconUrl(talent.spells[0] || 0);
                      return (
                        <div key={colIdx}
                          draggable
                          onDragStart={() => handleDragStart(talent.id, { type: 'spec' })}
                          onDragOver={handleDragOver}
                          onDrop={() => handleDrop(row1, col1, { type: 'spec' })}
                          onClick={() => { setSelectedTalentId(talent.id); setNewTalentDraft(null); }}
                          style={{
                            width: CELL_SIZE, height: CELL_SIZE,
                            border: `2px solid ${isSelected ? C.gold : classColor + '66'}`,
                            borderRadius: 6, cursor: 'grab', position: 'relative',
                            userSelect: 'none', overflow: 'hidden',
                            boxShadow: isSelected ? `0 0 8px ${C.gold}66` : 'none',
                            background: C.bg,
                          }}
                          title={`#${talent.id} - Spell ${talent.spells[0] || 0}`}
                        >
                          {iconUrl ? (
                            <img src={iconUrl} alt="" style={{ width: '100%', height: '100%' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDim }}>?</div>
                          )}
                          <span style={{
                            position: 'absolute', bottom: 1, right: 2,
                            fontSize: 9, fontWeight: 700, color: '#fff',
                            textShadow: '0 0 3px #000, 0 0 3px #000', lineHeight: 1,
                          }}>#{talent.id}</span>
                          <span style={{
                            position: 'absolute', bottom: 1, left: 2,
                            fontSize: 8, color: '#ccc',
                            textShadow: '0 0 3px #000, 0 0 3px #000', lineHeight: 1,
                          }}>R{talent.maxRank}</span>
                          {talent.mastery && (
                            <div style={{
                              position: 'absolute', top: -3, right: -3,
                              width: 8, height: 8, borderRadius: 4,
                              background: C.gold,
                            }} />
                          )}
                        </div>
                      );
                    }

                    return (
                      <div key={colIdx}
                        onDragOver={handleDragOver}
                        onDrop={() => handleDrop(row1, col1, { type: 'spec' })}
                        onClick={() => openNewTalent(row1, col1, { type: 'spec' })}
                        style={{
                          width: CELL_SIZE, height: CELL_SIZE,
                          border: `1px dashed ${dragTalentId ? C.accent + '66' : C.border}`,
                          borderRadius: 6,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 14, color: C.border + '88', cursor: 'pointer',
                          transition: 'border-color 0.15s',
                        }}
                        title={`Empty - R${row1} C${col1} (click to add)`}
                      >
                        {dragTalentId ? 'v' : '+'}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Talent list */}
          <div style={{
            marginTop: 12, background: C.bgLight, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: 12, maxHeight: 240, overflowY: 'auto',
          }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>
              {currentSpec?.name} - {specTalents.length} talents
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {specTalents.slice().sort((a, b) => a.id - b.id).map(t => {
                const isSelected = selectedTalentId === t.id;
                const iconUrl = getSpellIconUrl(t.spells[0] || 0);
                return (
                  <div key={t.id} draggable onDragStart={() => handleDragStart(t.id, { type: 'spec' })}
                    onClick={() => { setSelectedTalentId(t.id); setNewTalentDraft(null); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '2px 6px', borderRadius: 4, cursor: 'grab', fontSize: 10,
                      background: isSelected ? C.gold + '22' : 'transparent',
                      border: `1px solid ${isSelected ? C.gold + '66' : 'transparent'}`,
                    }}
                  >
                    <div style={{ width: 18, height: 18, borderRadius: 3, overflow: 'hidden', flexShrink: 0, background: C.bg }}>
                      {iconUrl ? <img src={iconUrl} alt="" style={{ width: 18, height: 18 }} /> : null}
                    </div>
                    <span style={{ fontWeight: 700, color: C.textBright }}>#{t.id}</span>
                    <span style={{ color: C.textDim }}>R{t.row}C{t.col}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT: Hero Trees + Editor */}
        <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Hero Tree (toggle) */}
          <div style={{
            background: C.bgLight, border: `1px solid ${activeHeroIdx === 0 ? HERO1_COLOR : HERO2_COLOR}40`,
            borderRadius: 8, padding: 12,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${activeHeroIdx === 0 ? HERO1_COLOR : HERO2_COLOR}33`,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                color: activeHeroIdx === 0 ? HERO1_COLOR : HERO2_COLOR, letterSpacing: 1,
              }}>
                Hero Tree {activeHeroIdx + 1} ({heroZoneTalents.length})
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => setActiveHeroIdx(0)}
                  style={{
                    ...smallBtnStyle,
                    color: activeHeroIdx === 0 ? HERO1_COLOR : C.textDim,
                    borderColor: activeHeroIdx === 0 ? HERO1_COLOR + '55' : C.border,
                  }}
                >Hero 1</button>
                <button
                  onClick={() => setActiveHeroIdx(1)}
                  style={{
                    ...smallBtnStyle,
                    color: activeHeroIdx === 1 ? HERO2_COLOR : C.textDim,
                    borderColor: activeHeroIdx === 1 ? HERO2_COLOR + '55' : C.border,
                  }}
                >Hero 2</button>
              </div>
            </div>
            {Array.from({ length: SIDE_TREE_ROWS }, (_, r) => {
              const row1 = r + 1;
              return (
                <div key={r} style={{ display: 'flex', gap: CELL_GAP, marginBottom: CELL_GAP, justifyContent: 'center' }}>
                  {Array.from({ length: SIDE_TREE_COLS }, (_, c) => {
                    const col1 = c + 1;
                    const centerCol = 2;
                    const isCorner = (row1 === 1 || row1 === SIDE_TREE_ROWS) && col1 !== centerCol;
                    if (isCorner) return <div key={c} style={{ width: CELL_SIZE, height: CELL_SIZE }} />;

                    const talent = heroZoneTalents.find(t => t.row === row1 && t.col === col1);
                    const isSelected = talent && selectedTalentId === talent.id;
                    if (talent) {
                      const iconUrl = getSpellIconUrl(talent.spells[0] || 0);
                      return (
                        <div key={c} draggable onDragStart={() => handleDragStart(talent.id, { type: 'hero', heroIdx: activeHeroIdx })}
                          onDragOver={handleDragOver} onDrop={() => handleDrop(row1, col1, { type: 'hero', heroIdx: activeHeroIdx })}
                          onClick={() => { setSelectedTalentId(talent.id); setNewTalentDraft(null); }}
                          style={{
                            width: CELL_SIZE, height: CELL_SIZE,
                            border: `2px solid ${isSelected ? C.gold : activeHeroIdx === 0 ? HERO1_COLOR : HERO2_COLOR}`,
                            borderRadius: 6, cursor: 'grab', position: 'relative',
                            userSelect: 'none', overflow: 'hidden', background: C.bg,
                          }}
                          title={`#${talent.id} - Spell ${talent.spells[0] || 0}`}
                        >
                          {iconUrl ? (
                            <img src={iconUrl} alt="" style={{ width: '100%', height: '100%' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDim }}>?</div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div key={c}
                        onDragOver={handleDragOver} onDrop={() => handleDrop(row1, col1, { type: 'hero', heroIdx: activeHeroIdx })}
                        onClick={() => openNewTalent(row1, col1, { type: 'hero', heroIdx: activeHeroIdx })}
                        style={{
                          width: CELL_SIZE, height: CELL_SIZE,
                          border: `1px dashed ${dragTalentId ? C.accent + '66' : C.border}`,
                          borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 14, color: C.border + '88', cursor: 'pointer',
                        }}
                      >
                        {dragTalentId ? 'v' : '+'}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div style={{
            background: C.bgLight, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: 16,
            maxHeight: 'calc(100vh - 280px)', overflowY: 'auto', flex: 1,
          }}>
            {!displayedTalent ? (
              <div style={{ color: C.textDim, fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
                <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>+</div>
                Click a talent to edit properties<br />
                Click an empty cell to add a talent
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h4 style={{ margin: 0, color: C.textBright }}>
                    {newTalentDraft ? 'New Talent' : `Talent #${displayedTalent.id}`}
                  </h4>
                  <button onClick={() => { setSelectedTalentId(null); setNewTalentDraft(null); }}
                    style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 18 }}>x</button>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12,
                  padding: 8, background: C.bg, borderRadius: 8,
                }}>
                  <div style={{ border: `2px solid ${C.green}`, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
                    {(() => {
                      const url = getSpellIconUrl(displayedTalent.spells?.[0] || 0);
                      return url ? <img src={url} alt="" style={{ width: 48, height: 48 }} /> : (
                        <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: C.textDim }}>+</div>
                      );
                    })()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.textBright }}>
                      {currentSpec?.name}
                    </div>
                    <div style={{ fontSize: 11, color: C.gold, fontFamily: 'monospace' }}>
                      Spell: {displayedTalent.spells?.[0] || '(none)'}
                    </div>
                    <div style={{ fontSize: 10, color: C.textDim }}>
                      R{displayedTalent.row} C{displayedTalent.col} | {displayedTalent.maxRank} ranks
                    </div>
                  </div>
                </div>

                {/* Position */}
                <FieldGroup label="Position">
                  <Field label="Row">
                    <input type="number" min={1} max={MAX_GRID} value={displayedTalent.row}
                      onChange={e => {
                        const v = Math.max(1, Math.min(MAX_GRID, Number(e.target.value)));
                        newTalentDraft
                          ? updateDraft(t => ({ ...t, row: v }))
                          : updateTalent(displayedTalent.id, t => ({ ...t, row: v }));
                      }}
                      style={inputStyle} />
                  </Field>
                  <Field label="Col">
                    <input type="number" min={1} max={MAX_GRID} value={displayedTalent.col}
                      onChange={e => {
                        const v = Math.max(1, Math.min(MAX_GRID, Number(e.target.value)));
                        newTalentDraft
                          ? updateDraft(t => ({ ...t, col: v }))
                          : updateTalent(displayedTalent.id, t => ({ ...t, col: v }));
                      }}
                      style={inputStyle} />
                  </Field>
                </FieldGroup>

                {/* Max rank */}
                <FieldGroup label="Max Rank">
                  <Field label="Ranks">
                    <input type="number" min={0} max={9} value={displayedTalent.maxRank}
                      onChange={e => {
                        const v = Math.max(0, Math.min(9, Number(e.target.value)));
                        const adjust = (t: TalentDef) => {
                          const spells = t.spells ? [...t.spells] : [];
                          while (spells.length < v) spells.push(0);
                          if (spells.length > v) spells.length = v;
                          return { ...t, maxRank: v, spells };
                        };
                        newTalentDraft ? updateDraft(adjust) : updateTalent(displayedTalent.id, adjust);
                      }}
                      style={inputStyle} />
                  </Field>
                </FieldGroup>

                {/* Spells */}
                <FieldGroup label="Spell Ranks">
                  {(displayedTalent.spells || []).map((sp, i) => (
                    <Field key={i} label={`Rank ${i + 1}`}>
                      <input type="number" value={sp}
                        onChange={e => {
                          const v = Number(e.target.value) || 0;
                          const adjust = (t: TalentDef) => {
                            const spells = [...(t.spells || [])];
                            spells[i] = v;
                            return { ...t, spells };
                          };
                          newTalentDraft ? updateDraft(adjust) : updateTalent(displayedTalent.id, adjust);
                        }}
                        style={inputStyle} />
                    </Field>
                  ))}
                  <button
                    onClick={() => {
                      const adjust = (t: TalentDef) => ({
                        ...t,
                        spells: [...(t.spells || []), 0],
                        maxRank: Math.max(t.maxRank, (t.spells?.length || 0) + 1),
                      });
                      newTalentDraft ? updateDraft(adjust) : updateTalent(displayedTalent.id, adjust);
                    }}
                    style={{ ...smallBtnStyle, color: C.accent, borderColor: C.accent + '55' }}
                  >+ Add Rank</button>
                </FieldGroup>

                {/* Spell lookup */}
                <FieldGroup label="Spell Lookup">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="number"
                      value={spellLookupId || ''}
                      onChange={e => setSpellLookupId(Number(e.target.value) || 0)}
                      placeholder="Spell ID"
                      style={inputStyle}
                    />
                    <div style={{ width: 32, height: 32, borderRadius: 4, overflow: 'hidden', background: C.bg, border: `1px solid ${C.border}` }}>
                      {(() => {
                        const url = getSpellIconUrl(spellLookupId || 0);
                        return url ? <img src={url} alt="" style={{ width: 32, height: 32 }} /> : null;
                      })()}
                    </div>
                    <button
                      onClick={() => {
                        if (!displayedTalent) return;
                        const spellId = Number(spellLookupId) || 0;
                        if (!spellId) return;
                        applySpellToRank1(spellId);
                      }}
                      style={{ ...smallBtnStyle, color: C.green, borderColor: C.green + '55' }}
                      title="Set Rank 1 spell"
                    >Use Rank 1</button>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <input
                      type="text"
                      value={spellSearch}
                      onChange={e => setSpellSearch(e.target.value)}
                      placeholder="Search spell name..."
                      style={{ ...inputStyle, width: '100%' }}
                    />
                    {spellResults.length > 0 && (
                      <div style={{
                        marginTop: 6,
                        maxHeight: 160,
                        overflowY: 'auto',
                        border: `1px solid ${C.border}`,
                        borderRadius: 6,
                        background: C.bg,
                      }}>
                        {spellResults.map((sp) => (
                          <div key={sp.id}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '6px 8px', borderBottom: `1px solid ${C.border}`,
                              cursor: 'pointer',
                            }}
                            onClick={() => {
                              setSpellLookupId(sp.id);
                              applySpellToRank1(sp.id);
                            }}
                          >
                            <div style={{ width: 24, height: 24, borderRadius: 4, overflow: 'hidden', background: C.bg, border: `1px solid ${C.border}` }}>
                              {(() => {
                                const url = getSpellIconUrl(sp.id);
                                return url ? <img src={url} alt="" style={{ width: 24, height: 24 }} /> : null;
                              })()}
                            </div>
                            <div style={{ flex: 1, fontSize: 12, color: C.textBright }}>{sp.name}</div>
                            <div style={{ fontSize: 11, color: C.textDim }}>#{sp.id}</div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSpellLookupId(sp.id);
                                applySpellToRank1(sp.id);
                              }}
                              style={{ ...smallBtnStyle, color: C.green, borderColor: C.green + '55' }}
                            >Use</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </FieldGroup>

                {/* Prereqs */}
                <FieldGroup label="Prerequisites">
                  {(displayedTalent.prereqs || []).map((p, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <Field label="Talent ID">
                        <input type="number" value={p.id}
                          onChange={e => {
                            const v = Number(e.target.value) || 0;
                            const adjust = (t: TalentDef) => {
                              const prereqs = [...(t.prereqs || [])];
                              prereqs[i] = { ...prereqs[i], id: v };
                              return { ...t, prereqs };
                            };
                            newTalentDraft ? updateDraft(adjust) : updateTalent(displayedTalent.id, adjust);
                          }}
                          style={inputStyle} />
                      </Field>
                      <Field label="Rank">
                        <input type="number" value={p.rank}
                          onChange={e => {
                            const v = Number(e.target.value) || 0;
                            const adjust = (t: TalentDef) => {
                              const prereqs = [...(t.prereqs || [])];
                              prereqs[i] = { ...prereqs[i], rank: v };
                              return { ...t, prereqs };
                            };
                            newTalentDraft ? updateDraft(adjust) : updateTalent(displayedTalent.id, adjust);
                          }}
                          style={inputStyle} />
                      </Field>
                      <button
                        onClick={() => {
                          const adjust = (t: TalentDef) => {
                            const prereqs = [...(t.prereqs || [])];
                            prereqs.splice(i, 1);
                            return { ...t, prereqs };
                          };
                          newTalentDraft ? updateDraft(adjust) : updateTalent(displayedTalent.id, adjust);
                        }}
                        style={{ ...smallBtnStyle, color: C.red, borderColor: C.red + '55' }}
                      >Remove</button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const adjust = (t: TalentDef) => ({
                        ...t,
                        prereqs: [...(t.prereqs || []), { id: 0, rank: 0 }],
                      });
                      newTalentDraft ? updateDraft(adjust) : updateTalent(displayedTalent.id, adjust);
                    }}
                    style={{ ...smallBtnStyle, color: C.accent, borderColor: C.accent + '55' }}
                  >+ Add Prereq</button>
                </FieldGroup>

                {/* Mastery */}
                <FieldGroup label="Mastery">
                  <label style={{ fontSize: 12, color: C.textDim, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={!!displayedTalent.mastery}
                      disabled={!masteryEditable}
                      onChange={e => {
                        if (!masteryEditable) return;
                        const checked = e.target.checked;
                        if (newTalentDraft) {
                          updateDraft(t => ({ ...t, mastery: checked }));
                          return;
                        }
                        if (!currentSpec) return;
                        setSpec(activeSpecIdx, (spec) => ({
                          ...spec,
                          talents: spec.talents.map(t => {
                            if (t.id === displayedTalent.id) return { ...t, mastery: checked };
                            if (checked) return { ...t, mastery: false };
                            return t;
                          }),
                        }));
                      }}
                    />
                    Set as mastery (only one per spec)
                  </label>
                </FieldGroup>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  {newTalentDraft ? (
                    <button onClick={commitNewTalent} style={btnStyle(C.green)}>Add Talent</button>
                  ) : (
                    <button onClick={() => deleteTalent(displayedTalent.id)} style={btnStyle(C.red)}>Delete</button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#c9d1d9' }}>
      <span style={{ width: 70, color: '#8b949e' }}>{label}</span>
      {children}
    </label>
  );
}
