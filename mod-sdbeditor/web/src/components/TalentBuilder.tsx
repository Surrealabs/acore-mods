import React, { useState, useEffect, useMemo, useCallback } from 'react';
import TalentIcon from './TalentIcon';

type SpriteInfo = {
  sheet: string;
  x: number;
  y: number;
};

type Talent = {
  id: number;
  tabId: number;
  row: number;
  column: number;
  spellId: number;
  spellRanks?: number[];
  maxRank?: number;
  prereqTalents?: number[];
  prereqRanks?: number[];
  iconPath?: string | null;
  sprite?: SpriteInfo | null;
  mastery?: boolean;
};

type SpecLayout = {
  classCols: number;
  specColStart: number;
  specCols: number;
  heroColStart: number;
  heroCols: number;
  mainRows: number;
  hero1RowStart: number;
  hero1Rows: number;
  hero2RowStart: number;
  hero2Rows: number;
  totalCols: number;
  totalRows: number;
};

type Spec = {
  tabId: number;
  name?: string;
  rows?: number;
  cols?: number;
  layout?: SpecLayout;
  talents: Talent[];
};

type Props = {
  textColor: string;
  contentBoxColor: string;
  token?: string | null;
  gmLevel?: number;
};

const TalentBuilder: React.FC<Props> = ({ textColor, contentBoxColor, token, gmLevel = 0 }) => {
  // No class is selected by default — the builder starts on a bare class-icon
  // picker, then reveals spec selection, then hero-tree selection, mirroring
  // the in-game flow (class -> spec -> hero talent tree).
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [selectedSpecIdx, setSelectedSpecIdx] = useState<number | null>(null);
  const [selectedHeroIdx, setSelectedHeroIdx] = useState<number | null>(null);
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [loading, setLoading] = useState(false);
  const [tabNames, setTabNames] = useState<{ [key: number]: string }>({});
  const [spriteIconSize, setSpriteIconSize] = useState(64);
  const [spriteIconsPerRow, setSpriteIconsPerRow] = useState(16);
  const [allocatedPoints, setAllocatedPoints] = useState<{ [talentId: number]: number }>({});
  const MAX_TALENT_POINTS = 51;

  // Import/export state
  const [talentString, setTalentString] = useState('');
  const [showImportExport, setShowImportExport] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [characters, setCharacters] = useState<{ guid: number; name: string; level: number; class: number; online: number }[]>([]);
  const [selectedCharGuid, setSelectedCharGuid] = useState<number | null>(null);
  const [showApplyPanel, setShowApplyPanel] = useState(false);

  // Fetch talent tab names from server on mount
  useEffect(() => {
    const fetchTabNames = async () => {
      try {
        const response = await fetch('/api/talent-tab-names');
        if (response.ok) {
          const data = await response.json();
          setTabNames(data.tabNames || {});
        }
      } catch (error) {
        console.error('Error fetching tab names:', error);
      }
    };
    fetchTabNames();
  }, []);

  // Fetch talent data when class changes (no class selected = no fetch)
  useEffect(() => {
    if (!selectedClass) {
      setSpecs([]);
      return;
    }

    let isMounted = true;

    const fetchTalents = async () => {
      setLoading(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`/api/talents/${selectedClass}`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (isMounted && response.ok) {
          const data = await response.json();
          setSpecs(data.specs || []);
          if (data.spriteIconSize) setSpriteIconSize(data.spriteIconSize);
          if (data.spriteIconsPerRow) setSpriteIconsPerRow(data.spriteIconsPerRow);
        } else if (isMounted) {
          setSpecs([]);
        }
      } catch (error) {
        console.error('Error fetching talents:', error);
        if (isMounted) setSpecs([]);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchTalents();

    return () => {
      isMounted = false;
    };
  }, [selectedClass]);

  // Reset points and spec/hero selection on class change
  useEffect(() => {
    setAllocatedPoints({});
    setSelectedSpecIdx(null);
    setSelectedHeroIdx(null);
  }, [selectedClass]);

  // Reset hero-tree selection whenever the spec changes
  useEffect(() => {
    setSelectedHeroIdx(null);
  }, [selectedSpecIdx]);

  // Point allocation helpers
  const totalSpent = Object.values(allocatedPoints).reduce((sum, v) => sum + v, 0);
  const pointsInSpec = (tabId: number): number => {
    const spec = specs.find((s) => s.tabId === tabId);
    if (!spec) return 0;
    return (spec.talents || []).reduce((sum: number, t: Talent) => sum + (allocatedPoints[t.id] || 0), 0);
  };
  const canAllocate = (talent: Talent): boolean => {
    if (totalSpent >= MAX_TALENT_POINTS) return false;
    const current = allocatedPoints[talent.id] || 0;
    if (current >= (talent.maxRank || 1)) return false;
    // Row requirement: need 5 * row points in this spec
    const specPts = pointsInSpec(talent.tabId);
    if (specPts < talent.row * 5) return false;
    // Prereq check
    if (talent.prereqTalents) {
      for (let i = 0; i < talent.prereqTalents.length; i++) {
        const prereqId = talent.prereqTalents[i];
        if (prereqId && prereqId > 0) {
          const reqRanks = talent.prereqRanks?.[i] || 1;
          if ((allocatedPoints[prereqId] || 0) < reqRanks) return false;
        }
      }
    }
    return true;
  };
  const addPoint = (talent: Talent) => {
    if (!canAllocate(talent)) return;
    setAllocatedPoints(prev => ({ ...prev, [talent.id]: (prev[talent.id] || 0) + 1 }));
  };
  const removePoint = (talent: Talent) => {
    const current = allocatedPoints[talent.id] || 0;
    if (current <= 0) return;
    setAllocatedPoints(prev => ({ ...prev, [talent.id]: prev[talent.id] - 1 }));
  };
  const resetPoints = () => setAllocatedPoints({});

  // ── Wowhead-style talent string encode/decode ──
  // Format: digits per talent sorted row/col within each tree, trees separated by "-"
  // Trailing zeros stripped per tree. Example: "302023013-305053000520310053120501-0"

  const encodeTalentString = useCallback((): string => {
    if (specs.length === 0) return '';
    const trees: string[] = specs.map((spec) => {
      const sorted = [...(spec.talents || [])].sort((a: Talent, b: Talent) => a.row - b.row || a.column - b.column);
      const digits = sorted.map((t: Talent) => String(allocatedPoints[t.id] || 0));
      // Trim trailing zeros
      let str = digits.join('');
      str = str.replace(/0+$/, '');
      return str || '0';
    });
    return trees.join('-');
  }, [specs, allocatedPoints]);

  const decodeTalentString = useCallback((str: string) => {
    if (!str || specs.length === 0) return;
    const trees = str.split('-');
    const newPoints: { [talentId: number]: number } = {};

    specs.forEach((spec, treeIdx: number) => {
      const treeStr = trees[treeIdx] || '';
      const sorted = [...(spec.talents || [])].sort((a: Talent, b: Talent) => a.row - b.row || a.column - b.column);
      sorted.forEach((t: Talent, i: number) => {
        const pts = parseInt(treeStr[i] || '0', 10);
        if (pts > 0 && pts <= (t.maxRank || 5)) {
          newPoints[t.id] = pts;
        }
      });
    });

    setAllocatedPoints(newPoints);
  }, [specs]);

  // Update talent string when points change
  useEffect(() => {
    if (specs.length > 0) {
      setTalentString(encodeTalentString());
    }
  }, [allocatedPoints, specs, encodeTalentString]);

  // Fetch character list for apply feature
  useEffect(() => {
    if (!token) return;
    fetch('/api/starter/characters', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setCharacters(data.characters || []))
      .catch(() => setCharacters([]));
  }, [token]);

  const copyTalentString = () => {
    const str = encodeTalentString();
    navigator.clipboard.writeText(str).then(() => {
      setCopyFeedback('Copied!');
      setTimeout(() => setCopyFeedback(''), 2000);
    }).catch(() => {
      setCopyFeedback('Copy failed');
      setTimeout(() => setCopyFeedback(''), 2000);
    });
  };

  const importTalentString = () => {
    const input = prompt('Paste talent string (e.g. 302023013-305053000-0):');
    if (input && input.includes('-')) {
      decodeTalentString(input.trim());
    }
  };

  const applyToCharacter = async (charGuid: number, charName: string) => {
    if (!token || !talentString) return;
    setApplyBusy(true);
    setApplyStatus(null);
    try {
      const res = await fetch('/api/starter/apply-talents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          charGuid,
          className: selectedClass,
          talentString: encodeTalentString(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setApplyStatus(`Applied to ${charName}: ${data.learned} talents written`);
      } else {
        setApplyStatus(`Error: ${data.error}`);
      }
    } catch (e) {
      setApplyStatus(`Failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setApplyBusy(false);
    }
  };

  // Map class name to WoW class ID
  const classNameToId: { [key: string]: number } = {
    warrior: 1, paladin: 2, hunter: 3, rogue: 4, priest: 5,
    'death-knight': 6, shaman: 7, mage: 8, warlock: 9, druid: 11,
  };
  const selectedClassId = selectedClass ? classNameToId[selectedClass] : undefined;


  const classes = [
    'warrior',
    'paladin',
    'hunter',
    'rogue',
    'priest',
    'death-knight',
    'shaman',
    'mage',
    'warlock',
    'druid',
  ];

  // Map tabId to spec name for each class
  const tabIdToSpecName: { [key: string]: { [key: number]: string } } = {
    warrior: { 161: 'Arms', 164: 'Fury', 163: 'Protection' },
    paladin: { 381: 'Holy', 382: 'Protection', 383: 'Retribution' },
    hunter: { 361: 'Beast Mastery', 362: 'Marksmanship', 363: 'Survival' },
    rogue: { 181: 'Assassination', 182: 'Combat', 183: 'Subtlety' },
    priest: { 201: 'Discipline', 202: 'Holy', 203: 'Shadow' },
    'death-knight': { 398: 'Blood', 399: 'Frost', 400: 'Unholy' },
    shaman: { 261: 'Elemental', 262: 'Enhancement', 263: 'Restoration' },
    mage: { 41: 'Arcane', 61: 'Fire', 81: 'Frost' },
    warlock: { 301: 'Affliction', 302: 'Demonology', 303: 'Destruction' },
    druid: { 281: 'Balance', 282: 'Feral', 283: 'Restoration' },
  };

  const getClassIcon = (className: string) => {
    const iconName = className === 'death-knight' ? 'deathknight' : className;
    return `/class-icons/icon-${iconName}.png`;
  };

  const talentTrees = [
    { name: 'Tree 1', id: 1 },
    { name: 'Tree 2', id: 2 },
    { name: 'Tree 3', id: 3 },
  ];

  const classSpecs: { [key: string]: { name: string; bg: string }[] } = {
    warrior: [
      { name: 'Arms', bg: 'arms' },
      { name: 'Fury', bg: 'fury' },
      { name: 'Protection', bg: 'protection' },
    ],
    paladin: [
      { name: 'Holy', bg: 'holy' },
      { name: 'Protection', bg: 'protection' },
      { name: 'Retribution', bg: 'retribution' },
    ],
    hunter: [
      { name: 'Beast Mastery', bg: 'beastmastery' },
      { name: 'Marksmanship', bg: 'marksmanship' },
      { name: 'Survival', bg: 'survival' },
    ],
    rogue: [
      { name: 'Assassination', bg: 'assassination' },
      { name: 'Combat', bg: 'combat' },
      { name: 'Subtlety', bg: 'subtlety' },
    ],
    priest: [
      { name: 'Discipline', bg: 'discipline' },
      { name: 'Holy', bg: 'holy' },
      { name: 'Shadow', bg: 'shadow' },
    ],
    'death-knight': [
      { name: 'Blood', bg: 'blood' },
      { name: 'Frost', bg: 'frost' },
      { name: 'Unholy', bg: 'unholy' },
    ],
    shaman: [
      { name: 'Elemental', bg: 'elemental' },
      { name: 'Enhancement', bg: 'enhancement' },
      { name: 'Restoration', bg: 'restoration' },
    ],
    mage: [
      { name: 'Arcane', bg: 'arcane' },
      { name: 'Fire', bg: 'fire' },
      { name: 'Frost', bg: 'frost' },
    ],
    warlock: [
      { name: 'Affliction', bg: 'affliction' },
      { name: 'Demonology', bg: 'demonology' },
      { name: 'Destruction', bg: 'destruction' },
    ],
    druid: [
      { name: 'Balance', bg: 'balance' },
      { name: 'Feral', bg: 'feral' },
      { name: 'Restoration', bg: 'restoration' },
    ],
  };

  const getSpecBackground = (className: string, specBg: string) => {
    return `http://${window.location.hostname}:3001/class-backgrounds/bg-${className}-${specBg}.jpg`;
  };

  // Representative icon for a spec's compact picker tile: prefer the spec's
  // mastery-flagged talent's icon (mirrors retail's spec-select screen, which
  // shows the mastery icon), falling back to the first talent by row/col, and
  // finally to the classic WoW "unknown" icon when nothing is available yet.
  const getSpecIconPath = (spec: Spec): string => {
    const talents = spec.talents || [];
    const mastery = talents.find((t: Talent) => t.mastery);
    if (mastery?.iconPath) return mastery.iconPath;
    const sorted = [...talents].sort((a: Talent, b: Talent) => a.row - b.row || a.column - b.column);
    return sorted[0]?.iconPath || 'INV_Misc_QuestionMark';
  };

  // Shared talent-cell renderer used by both the main spec grid and the
  // hero-tree grid so the two don't duplicate this large block of JSX/styles.
  const renderTalentCell = (talent: Talent | undefined, cellIdx: number) => {
    const pts = talent ? (allocatedPoints[talent.id] || 0) : 0;
    const maxR = talent?.maxRank || 1;
    const canAdd = talent ? canAllocate(talent) : false;
    const isMaxed = pts >= maxR;
    const hasPoints = pts > 0;

    return (
      <div
        key={cellIdx}
        title={talent ? `#${talent.id} | Spell: ${talent.spellId} | ${pts}/${maxR} ranks${talent.spellRanks ? '\nRanks: ' + talent.spellRanks.filter((s: number) => s > 0).join(', ') : ''}` : undefined}
        onClick={() => talent && addPoint(talent)}
        onContextMenu={(e) => { e.preventDefault(); talent && removePoint(talent); }}
        style={{
          width: 40,
          height: 40,
          background: talent ? '#2a2a2a' : 'rgba(255,255,255,0.1)',
          borderRadius: 4,
          border: talent
            ? isMaxed
              ? '2px solid #FFD700'
              : hasPoints
                ? '2px solid #4CAF50'
                : canAdd
                  ? '2px solid #666'
                  : '2px solid #444'
            : '1px solid rgba(255,255,255,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: talent ? (canAdd ? 'pointer' : 'default') : 'default',
          transition: 'all 0.2s ease',
          overflow: 'hidden',
          position: 'relative',
          opacity: talent ? (canAdd || hasPoints ? 1 : 0.5) : 1,
        }}
        onMouseEnter={(e) => {
          if (talent) {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1.15)';
            (e.currentTarget as HTMLElement).style.zIndex = '10';
            (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(76, 175, 80, 0.8)';
          }
        }}
        onMouseLeave={(e) => {
          if (talent) {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
            (e.currentTarget as HTMLElement).style.zIndex = '1';
            (e.currentTarget as HTMLElement).style.boxShadow = 'none';
          }
        }}
      >
        {talent && (
          <>
            <TalentIcon iconPath={talent.iconPath} sprite={talent.sprite || null} size={36} spriteIconSize={spriteIconSize} spriteIconsPerRow={spriteIconsPerRow} />
            {/* Rank badge */}
            <div style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              background: 'rgba(0,0,0,0.85)',
              color: isMaxed ? '#FFD700' : hasPoints ? '#4CAF50' : '#888',
              fontSize: 9,
              fontWeight: 'bold',
              padding: '0 3px',
              borderRadius: '3px 0 0 0',
              lineHeight: '14px',
            }}>
              {pts}/{maxR}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: 12, color: textColor }}>
      <h2 style={{ textAlign: 'left', color: textColor }}>Spec Builder</h2>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ margin: 0, opacity: 0.7 }}>
          {loading ? '⏳ Loading talent data...' : 'Left-click to add a point, right-click to remove.'}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 'bold', color: totalSpent >= MAX_TALENT_POINTS ? '#f44336' : '#4FC3F7' }}>
            {totalSpent} / {MAX_TALENT_POINTS}
          </span>
          <button
            onClick={resetPoints}
            disabled={totalSpent === 0}
            style={{
              padding: '4px 12px',
              background: totalSpent > 0 ? '#f44336' : '#555',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: totalSpent > 0 ? 'pointer' : 'not-allowed',
              fontSize: 12,
            }}
          >
            Reset
          </button>
          <button
            onClick={copyTalentString}
            disabled={totalSpent === 0}
            style={{
              padding: '4px 12px',
              background: totalSpent > 0 ? '#007bff' : '#555',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: totalSpent > 0 ? 'pointer' : 'not-allowed',
              fontSize: 12,
            }}
          >
            {copyFeedback || 'Export'}
          </button>
          <button
            onClick={importTalentString}
            style={{
              padding: '4px 12px',
              background: '#28a745',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Import
          </button>
          {token && (
            <button
              onClick={() => setShowApplyPanel(!showApplyPanel)}
              disabled={totalSpent === 0}
              style={{
                padding: '4px 12px',
                background: totalSpent > 0 ? '#ff9800' : '#555',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: totalSpent > 0 ? 'pointer' : 'not-allowed',
                fontSize: 12,
              }}
            >
              Apply ▾
            </button>
          )}
        </div>
      </div>

      {/* Talent string display */}
      {totalSpent > 0 && (
        <div style={{ marginBottom: 12, padding: '6px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: 6, fontFamily: 'monospace', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ opacity: 0.5, fontSize: 11 }}>Build:</span>
          <span style={{ flex: 1, wordBreak: 'break-all' }}>{talentString}</span>
        </div>
      )}

      {/* Apply to character panel */}
      {showApplyPanel && token && totalSpent > 0 && (
        <div style={{
          marginBottom: 12,
          padding: 12,
          background: contentBoxColor,
          border: '1px solid #555',
          borderRadius: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>Apply Build to Character</strong>
            <button onClick={() => setShowApplyPanel(false)} style={{ background: 'none', border: 'none', color: textColor, cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
          <p style={{ fontSize: 12, opacity: 0.6, margin: '0 0 8px 0' }}>
            Resets the character's talents and applies this build. Character must be offline.
          </p>
          {characters.length === 0 ? (
            <p style={{ fontSize: 12, color: '#999' }}>No characters found on your account.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {characters
                .filter(c => c.class === selectedClassId)
                .map(c => (
                  <button
                    key={c.guid}
                    disabled={applyBusy || c.online === 1}
                    onClick={() => {
                      if (confirm(`Apply this ${selectedClass} build to ${c.name}? This will RESET their current talents.`)) {
                        applyToCharacter(c.guid, c.name);
                      }
                    }}
                    style={{
                      padding: '6px 12px',
                      background: c.online === 1 ? '#333' : '#ff9800',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      cursor: c.online === 1 ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                      opacity: c.online === 1 ? 0.5 : 1,
                    }}
                    title={c.online === 1 ? 'Character is online — log out first' : `Apply to ${c.name}`}
                  >
                    {c.name} (Lv{c.level}){c.online === 1 ? ' 🟢' : ''}
                  </button>
                ))
              }
              {characters.filter(c => c.class === selectedClassId).length === 0 && (
                <p style={{ fontSize: 12, color: '#999' }}>No {selectedClass} characters on your account.</p>
              )}
            </div>
          )}
          {applyStatus && (
            <p style={{ fontSize: 12, marginTop: 8, color: applyStatus.startsWith('Error') || applyStatus.startsWith('Failed') ? '#f44336' : '#4CAF50' }}>
              {applyStatus}
            </p>
          )}
        </div>
      )}

      {/* Step 1: Select Class — no class is selected by default, just the icons */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontWeight: 'bold' }}>Select Class:</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginTop: 8 }}>
          {classes.map((cls) => (
            <div
              key={cls}
              onClick={() => setSelectedClass(cls)}
              style={{
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <img 
                src={getClassIcon(cls)} 
                alt={cls} 
                style={{ 
                  width: 64, 
                  height: 64,
                  borderRadius: 8,
                  boxShadow: selectedClass === cls 
                    ? '0 0 16px 4px rgba(0, 123, 255, 0.8)' 
                    : '0 2px 4px rgba(0,0,0,0.2)',
                  border: selectedClass === cls ? '2px solid #007bff' : '2px solid transparent',
                  transition: 'all 0.2s ease',
                }}
                onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64"%3E%3Crect width="64" height="64" fill="%23ccc"/%3E%3C/svg%3E'; }}
              />
              <span style={{ 
                fontSize: 12, 
                textTransform: 'capitalize',
                color: textColor,
                fontWeight: selectedClass === cls ? 'bold' : 'normal',
              }}>
                {cls.replace('-', ' ')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Step 2: Select Spec — only shown once a class has been picked */}
      {selectedClass && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontWeight: 'bold' }}>Select Spec:</label>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
            {loading && (
              <p style={{ opacity: 0.6, margin: 0 }}>⏳ Loading specs...</p>
            )}
            {!loading && specs.length === 0 && (
              <p style={{ opacity: 0.6, margin: 0 }}>No specs configured for this class yet.</p>
            )}
            {!loading && specs.map((spec, idx) => {
              const specName = spec.name || tabNames[spec.tabId] || `Spec ${idx + 1}`;
              const iconPath = getSpecIconPath(spec);
              const isSelected = selectedSpecIdx === idx;
              return (
                <div
                  key={spec.tabId ?? idx}
                  onClick={() => setSelectedSpecIdx(idx)}
                  style={{
                    cursor: 'pointer',
                    width: 76,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 8,
                      overflow: 'hidden',
                      boxShadow: isSelected
                        ? '0 0 16px 4px rgba(0, 123, 255, 0.8)'
                        : '0 2px 4px rgba(0,0,0,0.2)',
                      border: isSelected ? '2px solid #007bff' : '2px solid transparent',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <TalentIcon iconPath={iconPath} size={48} />
                  </div>
                  <span style={{
                    fontSize: 12,
                    textAlign: 'center',
                    color: textColor,
                    fontWeight: isSelected ? 'bold' : 'normal',
                  }}>
                    {specName}
                  </span>
                  <span style={{ fontSize: 10, color: '#4FC3F7' }}>
                    {pointsInSpec(spec.tabId)} pts
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 3: Talent tree + hero-tree selection — only shown once a spec has been picked */}
      {selectedClass && selectedSpecIdx !== null && specs[selectedSpecIdx] && (() => {
        const spec = specs[selectedSpecIdx];
        const specName = spec.name || tabNames[spec.tabId] || `Spec ${selectedSpecIdx + 1}`;
        const bgSpec = classSpecs[selectedClass]?.[selectedSpecIdx];
        const layout = spec.layout;
        const talentsList = spec.talents || [];

        // Spec-tree zone: columns/rows come from the server's layout metadata
        // (matches Talent Editor's combined class/spec/hero coordinate space).
        // Falls back to a plain 4x11 grid with no column offset for the legacy
        // DBC-sourced path, which has no layout/mastery metadata.
        const gridCols = layout?.specCols ?? 4;
        const gridRows = layout?.mainRows ?? 11;
        const colOffset = layout?.specColStart ?? 0;

        // Prefer the explicit mastery flag; fall back to the old
        // "first talent by row/col" heuristic when no flag is present
        // (legacy DBC-sourced data has no mastery metadata at all).
        const flaggedMastery = talentsList.find((t: Talent) => t.mastery);
        const masteryId = flaggedMastery
          ? flaggedMastery.id
          : [...talentsList].sort((a: Talent, b: Talent) => a.row - b.row || a.column - b.column)[0]?.id;

        // Hero-tree zone: only present when the server's layout metadata says so
        // (i.e. the JSON-config path). Legacy DBC-fallback data has no hero trees.
        const hasHeroTrees = !!layout && layout.heroCols > 0;
        const heroCols = layout?.heroCols ?? 3;
        const heroRows = layout?.hero1Rows ?? 5;
        const heroColOffset = layout?.heroColStart ?? -1;
        const heroRowOffset = selectedHeroIdx === 1
          ? (layout?.hero2RowStart ?? heroRows)
          : (layout?.hero1RowStart ?? 0);

        // Representative icon for a hero tree's selector button: the first
        // talent in that tree (by row/col order), falling back to the classic
        // question-mark icon when the tree has no talents placed yet.
        const getHeroIconPath = (heroIdx: number): string => {
          const rowStart = heroIdx === 1 ? (layout?.hero2RowStart ?? heroRows) : (layout?.hero1RowStart ?? 0);
          const heroTalents = talentsList.filter((t: Talent) => {
            const localRow = t.row - rowStart;
            const localCol = t.column - heroColOffset;
            return localRow >= 0 && localRow < heroRows && localCol >= 0 && localCol < heroCols;
          });
          const sorted = [...heroTalents].sort(
            (a: Talent, b: Talent) => (a.row - rowStart) - (b.row - rowStart) || (a.column - heroColOffset) - (b.column - heroColOffset)
          );
          return sorted[0]?.iconPath || 'INV_Misc_QuestionMark';
        };

        // Class-tree zone: talents shared by every spec of this class, always
        // occupying columns 0..classCols-1 with no offset (Talent Editor stores
        // them unshifted). Same row count as the hero side-trees (SIDE_TREE_ROWS).
        // Only present for the JSON-config path — legacy DBC fallback has no layout.
        const hasClassTree = !!layout && layout.classCols > 0;
        const classCols = layout?.classCols ?? 3;
        const classRows = layout?.hero1Rows ?? 5;

        return (
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: 8,
              padding: 16,
              background: contentBoxColor,
              color: textColor,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {bgSpec && (
              <div
                style={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  backgroundImage: `url(${getSpecBackground(selectedClass === 'death-knight' ? 'deathknight' : selectedClass, bgSpec.bg)})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />
            )}
            {bgSpec && (
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)' }} />
            )}
            <div style={{ position: 'relative', zIndex: 1 }}>
              <h3 style={{ marginTop: 0, marginBottom: 16, color: bgSpec ? '#fff' : textColor, textShadow: bgSpec ? '2px 2px 4px rgba(0,0,0,0.8)' : 'none' }}>
                {specName} Talent Tree
                <span style={{ fontSize: 12, fontWeight: 'normal', opacity: 0.7, marginLeft: 6 }}>
                  ({pointsInSpec(spec.tabId)} pts)
                </span>
              </h3>

              <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {/* Class tree — shared across every spec of this class */}
                {hasClassTree && (
                  <div>
                    <label style={{ fontWeight: 'bold', color: bgSpec ? '#fff' : textColor, textShadow: bgSpec ? '2px 2px 4px rgba(0,0,0,0.8)' : 'none' }}>
                      Class Talents:
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${classCols}, 1fr)`, gap: 4, marginTop: 8 }}>
                      {Array.from({ length: classRows * classCols }).map((_, cellIdx) => {
                        const row = Math.floor(cellIdx / classCols);
                        const col = cellIdx % classCols;
                        const talent = talentsList.find(
                          (t: Talent) => t.row === row && t.column === col
                        );
                        // Diamond shape, matching Talent Editor's Class Tree grid: the
                        // top/bottom row's non-center corner cells are decorative empty
                        // spacers, UNLESS a talent has actually been placed there — in
                        // which case it still renders (never silently hide real data).
                        const centerCol = Math.floor(classCols / 2);
                        const isCorner = (row === 0 || row === classRows - 1) && col !== centerCol;
                        if (isCorner && !talent) return <div key={cellIdx} style={{ width: 40, height: 40 }} />;
                        return renderTalentCell(talent, cellIdx);
                      })}
                    </div>
                  </div>
                )}

                {/* Main spec grid */}
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gap: 4 }}>
                  {Array.from({ length: gridRows * gridCols }).map((_, cellIdx) => {
                    const row = Math.floor(cellIdx / gridCols);
                    const col = cellIdx % gridCols;
                    const talent = talentsList.find(
                      (t: Talent) => t.row === row && (t.column - colOffset) === col && t.id !== masteryId
                    );
                    return renderTalentCell(talent, cellIdx);
                  })}
                </div>

                {/* Step 4: Hero talent tree selection + preview */}
                {hasHeroTrees && (
                  <div>
                    <label style={{ fontWeight: 'bold', color: bgSpec ? '#fff' : textColor, textShadow: bgSpec ? '2px 2px 4px rgba(0,0,0,0.8)' : 'none' }}>
                      Select Hero Talent Tree:
                    </label>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 12 }}>
                      {[0, 1].map((heroIdx) => {
                        const heroColor = heroIdx === 0 ? '#f778ba' : '#bc8cff';
                        const isActive = selectedHeroIdx === heroIdx;
                        return (
                          <button
                            key={heroIdx}
                            onClick={() => setSelectedHeroIdx(heroIdx)}
                            title={`Hero Tree ${heroIdx + 1}`}
                            style={{
                              width: 40,
                              height: 40,
                              padding: 0,
                              background: isActive ? heroColor + '33' : 'rgba(255,255,255,0.1)',
                              border: `2px solid ${isActive ? heroColor : heroColor + '55'}`,
                              borderRadius: 6,
                              cursor: 'pointer',
                              overflow: 'hidden',
                              boxShadow: isActive ? `0 0 10px ${heroColor}aa` : 'none',
                              transition: 'all 0.2s ease',
                            }}
                          >
                            <TalentIcon iconPath={getHeroIconPath(heroIdx)} size={36} />
                          </button>
                        );
                      })}
                    </div>
                    {selectedHeroIdx !== null ? (
                      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${heroCols}, 1fr)`, gap: 4 }}>
                        {Array.from({ length: heroRows * heroCols }).map((_, cellIdx) => {
                          const row = Math.floor(cellIdx / heroCols);
                          const col = cellIdx % heroCols;
                          const talent = talentsList.find(
                            (t: Talent) => (t.row - heroRowOffset) === row && (t.column - heroColOffset) === col
                          );
                          // Same diamond-shape convention as the Class Tree above.
                          const centerCol = Math.floor(heroCols / 2);
                          const isCorner = (row === 0 || row === heroRows - 1) && col !== centerCol;
                          if (isCorner && !talent) return <div key={cellIdx} style={{ width: 40, height: 40 }} />;
                          return renderTalentCell(talent, cellIdx);
                        })}
                      </div>
                    ) : (
                      <p style={{ fontSize: 12, opacity: 0.7, color: bgSpec ? '#fff' : textColor }}>
                        Pick a hero talent tree to preview it.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default TalentBuilder;
