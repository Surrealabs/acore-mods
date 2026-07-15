// Error logging for SpellIconEditor
function logSpellIconEditorError(message: string) {
  fetch('/error-logs/spell-icon-errors.log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  }).catch(() => {});
}

// Ensures a string ends with .blp (case-insensitive)
function ensureBlpExtension(name: string): string {
  return name.toLowerCase().endsWith('.blp') ? name : name + '.blp';
}
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { DBCParser, SpellIconParser, type SpellIconRecord } from "../lib/dbc-parser";
import { loadConfig, type AppConfig } from "../lib/config";

type QuickFilter = "all" | "misc" | ClassKey | ProfessionKey;
type ClassKey =
  | "warrior"
  | "paladin"
  | "hunter"
  | "rogue"
  | "priest"
  | "deathknight"
  | "shaman"
  | "mage"
  | "warlock"
  | "druid";
type ProfessionKey =
  | "alchemy"
  | "blacksmithing"
  | "enchanting"
  | "engineering"
  | "herbalism"
  | "inscription"
  | "jewelcrafting"
  | "leatherworking"
  | "mining"
  | "skinning"
  | "tailoring"
  | "cooking"
  | "firstaid"
  | "fishing";

const CLASS_FILTERS: Array<{ key: ClassKey; label: string; icon: string; keywords: string[] }> = [
  { key: "warrior", label: "Warrior", icon: "⚔️", keywords: ["warrior", "arms", "fury", "protection", "stance", "bladestorm", "mortalstrike", "shield"] },
  { key: "paladin", label: "Paladin", icon: "🛡️", keywords: ["paladin", "holy", "retribution", "protection", "crusader", "avenger", "judgement"] },
  { key: "hunter", label: "Hunter", icon: "🏹", keywords: ["hunter", "beast", "marksmanship", "survival", "trap", "pet", "shot"] },
  { key: "rogue", label: "Rogue", icon: "🗡️", keywords: ["rogue", "assassination", "combat", "subtlety", "stealth", "poison", "eviscerate"] },
  { key: "priest", label: "Priest", icon: "✝️", keywords: ["priest", "discipline", "holy", "shadow", "mind", "smite"] },
  { key: "deathknight", label: "Death Knight", icon: "💀", keywords: ["deathknight", "death_knight", "dk", "blood", "frost", "unholy", "rune"] },
  { key: "shaman", label: "Shaman", icon: "🌩️", keywords: ["shaman", "elemental", "enhancement", "restoration", "totem", "lightning"] },
  { key: "mage", label: "Mage", icon: "❄️", keywords: ["mage", "arcane", "fire", "frost", "spellfrost", "pyro", "blizzard"] },
  { key: "warlock", label: "Warlock", icon: "🜏", keywords: ["warlock", "affliction", "demonology", "destruction", "fel", "curse", "shadowbolt"] },
  { key: "druid", label: "Druid", icon: "🌿", keywords: ["druid", "balance", "feral", "restoration", "bear", "cat", "moonkin", "wrath"] },
];

const PROF_FILTERS: Array<{ key: ProfessionKey; label: string; icon: string; keywords: string[] }> = [
  { key: "alchemy", label: "Alchemy", icon: "⚗️", keywords: ["alchemy", "potion", "elixir", "flask", "transmute"] },
  { key: "blacksmithing", label: "Blacksmithing", icon: "🔨", keywords: ["blacksmith", "blacksmithing", "anvil", "forge"] },
  { key: "enchanting", label: "Enchanting", icon: "✨", keywords: ["enchant", "enchanting", "disenchant", "arcanite"] },
  { key: "engineering", label: "Engineering", icon: "⚙️", keywords: ["engineering", "engineer", "goblin", "gnome", "bomb"] },
  { key: "herbalism", label: "Herbalism", icon: "🌱", keywords: ["herbalism", "herb", "flower", "bloom"] },
  { key: "inscription", label: "Inscription", icon: "🖋️", keywords: ["inscription", "glyph", "ink", "scribe"] },
  { key: "jewelcrafting", label: "Jewelcrafting", icon: "💎", keywords: ["jewel", "jewelcrafting", "gem", "prospect"] },
  { key: "leatherworking", label: "Leatherworking", icon: "🧵", keywords: ["leatherworking", "leather", "hide", "drums"] },
  { key: "mining", label: "Mining", icon: "⛏️", keywords: ["mining", "mine", "ore", "smelt"] },
  { key: "skinning", label: "Skinning", icon: "🦴", keywords: ["skinning", "skin", "carcass"] },
  { key: "tailoring", label: "Tailoring", icon: "🪡", keywords: ["tailor", "tailoring", "cloth", "weave"] },
  { key: "cooking", label: "Cooking", icon: "🍳", keywords: ["cooking", "cook", "food", "feast"] },
  { key: "firstaid", label: "First Aid", icon: "🩹", keywords: ["firstaid", "first_aid", "bandage"] },
  { key: "fishing", label: "Fishing", icon: "🎣", keywords: ["fishing", "fish", "lure", "hook"] },
];

function normalizedIconName(iconName: string): string {
  return iconName.toLowerCase().replace(/\.blp$/i, "");
}

function iconMatchesKeywords(iconName: string, keywords: string[]): boolean {
  const normalized = normalizedIconName(iconName);
  return keywords.some((keyword) => normalized.includes(keyword));
}

function getIconQuickBucket(iconName: string): QuickFilter {
  const matchedProfession = PROF_FILTERS.find((p) => iconMatchesKeywords(iconName, p.keywords));
  if (matchedProfession) return matchedProfession.key;
  const matchedClass = CLASS_FILTERS.find((c) => iconMatchesKeywords(iconName, c.keywords));
  if (matchedClass) return matchedClass.key;
  return "misc";
}

interface ImportedIcon {
  id: string;
  name: string;
  size: 32 | 64;
  imageData: ImageData;
  preview: string;
}

type Props = {
  textColor: string;
  contentBoxColor: string;
};

const SpellIconEditor: React.FC<Props> = ({ textColor, contentBoxColor }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragZoneRef = useRef<HTMLDivElement>(null);
  const dbcDragZoneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dbcInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [icons, setIcons] = useState<string[]>([]);
  const [selectedIcon, setSelectedIcon] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [dbcLoading, setDBCLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [thumbCacheBuster, setThumbCacheBuster] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [thumbStatus, setThumbStatus] = useState<string | null>(null);
  const [thumbRebuilding, setThumbRebuilding] = useState(false);
  const [importedIcons, setImportedIcons] = useState<ImportedIcon[]>([]);
  const [mode, setMode] = useState<"browse" | "create">("browse");
  const [existingDBC, setExistingDBC] = useState<SpellIconRecord[]>([]);
  const [dbcCompare, setDBCCompare] = useState<{ existing: Set<string>; new: Set<string> }>({
    existing: new Set(),
    new: new Set(),
  });
  const [namingPatterns, setNamingPatterns] = useState<string[]>([]);
  const [unmappedIcons, setUnmappedIcons] = useState<string[]>([]);
  const [selectedUnmapped, setSelectedUnmapped] = useState<Set<string>>(new Set());
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    // Global error handler for this component
    const errorHandler = (event: ErrorEvent) => {
      logSpellIconEditorError(`Uncaught error: ${event.message} at ${event.filename}:${event.lineno}`);
    };
    window.addEventListener('error', errorHandler);
    return () => window.removeEventListener('error', errorHandler);
  }, []);

  useEffect(() => {
    loadConfig().then(setConfig);
  }, []);

  useEffect(() => {
    const loadIconsList = async () => {
      try {
        const response = await fetch("/api/icon-manifest");
        if (response.ok) {
          const manifest = await response.json();
          // Keep ORIGINAL filenames WITH extensions (don't normalize)
          const files = Array.isArray(manifest.icons)
            ? manifest.icons.map((icon: { name: string }) => icon.name)
            : (manifest.files || []);
          setIcons(files);
          if (files.length > 0) setSelectedIcon(files[0]);
        }
      } catch (err) {
        console.error("Failed to load icons:", err);
      }
    };
    loadIconsList();
  }, []);

  const getThumbnailUrl = useCallback(
    (iconName: string): string => {
      const baseName = iconName.replace(/\.blp$/i, "");
      const cacheSuffix = thumbCacheBuster ? `?v=${thumbCacheBuster}` : "";
      return `/thumbnails/${baseName}.png${cacheSuffix}`;
    },
    [thumbCacheBuster]
  );

  useEffect(() => {
    const loadIcon = () => {
      if (!selectedIcon || mode !== "browse") return;
      setLoading(true);
      setError(null);
      try {
        const thumbSrc = getThumbnailUrl(selectedIcon);
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const img = new Image();
            img.onload = () => {
              canvas.width = img.width;
              canvas.height = img.height;
              ctx.drawImage(img, 0, 0);
              setLoading(false);
            };
            img.onerror = () => {
              setError(`Thumbnail not found for ${selectedIcon}`);
              setLoading(false);
            };
            img.src = thumbSrc;
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    loadIcon();
  }, [selectedIcon, mode, getThumbnailUrl]);

  const regenerateThumbnails = async () => {
    setThumbRebuilding(true);
    setThumbStatus('Regenerating thumbnails...');
    try {
      const res = await fetch('/api/generate-thumbnails', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || `Server returned ${res.status}`);
      const generated = result.generated ?? 0;
      const failed = result.failed ?? 0;
      setThumbStatus(`Thumbnails rebuilt (${generated} generated, ${failed} failed)`);
      setThumbCacheBuster(Date.now());
    } catch (err: any) {
      setThumbStatus(`Thumbnail rebuild failed: ${err.message}`);
    } finally {
      setThumbRebuilding(false);
    }
  };

  const handleDBCImport = async (file: File) => {
    setDBCLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const dbc = DBCParser.parseDBCFile(buffer);
      const parser = (SpellIconParser as any)?.parse
        ? SpellIconParser
        : (SpellIconParser as any)?.default;
      if (!parser || typeof parser.parse !== 'function') {
        const message = `SpellIconParser.parse is not a function (type: ${typeof SpellIconParser})`;
        logSpellIconEditorError(message);
        throw new Error(message);
      }
      const spellIcons = parser.parse(dbc);
      setExistingDBC(spellIcons);
      const existingNames = new Set<string>(spellIcons.map((r: any) => r.iconPath.toLowerCase()));
      setDBCCompare({ existing: existingNames, new: new Set(importedIcons.map((i: any) => i.name.toLowerCase())) });
      
      // Find unmapped icons (icons in public folder but not in DBC)
      const unmapped = icons.filter(icon => !existingNames.has(icon.toLowerCase()));
      setUnmappedIcons(unmapped);
      
      // Extract naming patterns
      const patterns = extractNamingPatterns(Array.from(existingNames));
      setNamingPatterns(patterns);
      
      setError(null);
    } catch (err) {
      setError(`Failed to parse DBC: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDBCLoading(false);
    }
  };

  const handleFileImport = async (files: FileList) => {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 64;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, 64, 64);
            const scale = Math.max(64 / img.width, 64 / img.height);
            const x = (64 - img.width * scale) / 2;
            const y = (64 - img.height * scale) / 2;
            ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
            const imageData = ctx.getImageData(0, 0, 64, 64);
            const baseName = file.name.split(".")[0];
            const preview = canvas.toDataURL();
            setImportedIcons((prev) => [...prev, {
              id: `${Date.now()}_${i}`,
              name: baseName.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
              size: 64,
              imageData,
              preview,
            }]);
          }
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragZoneRef.current) dragZoneRef.current.style.backgroundColor = "#e7f3ff";
  };

  const handleDragLeave = () => {
    if (dragZoneRef.current) dragZoneRef.current.style.backgroundColor = "#f9f9f9";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragZoneRef.current) dragZoneRef.current.style.backgroundColor = "#f9f9f9";
    handleFileImport(e.dataTransfer.files);
  };

  const handleDBCDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (dbcDragZoneRef.current) dbcDragZoneRef.current.style.backgroundColor = "#e7f3ff";
  };

  const handleDBCDragLeave = () => {
    if (dbcDragZoneRef.current) dbcDragZoneRef.current.style.backgroundColor = "#f9f9f9";
  };

  const handleDBCDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dbcDragZoneRef.current) dbcDragZoneRef.current.style.backgroundColor = "#f9f9f9";
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      if (files[i].name.toLowerCase().endsWith(".dbc")) {
        handleDBCImport(files[i]);
        break;
      }
    }
  };

  const updateIconName = (id: string, newName: string) => {
    setImportedIcons((prev) =>
      prev.map((icon) =>
        icon.id === id ? { ...icon, name: newName.toLowerCase().replace(/[^a-z0-9_]/g, "_") } : icon
      )
    );
  };

  const updateIconSize = (id: string, size: 32 | 64) => {
    setImportedIcons((prev) =>
      prev.map((icon) => (icon.id === id ? { ...icon, size } : icon))
    );
  };

  const removeIcon = (id: string) => {
    setImportedIcons((prev) => prev.filter((icon) => icon.id !== id));
  };

  const handleUploadToServer = async () => {
    if (importedIcons.length === 0) {
      setError("No icons to upload");
      return;
    }
    
    try {
      let uploaded = 0;
      let failed = 0;
      
      for (const icon of importedIcons) {
        try {
          // Convert to BLP format
          const blpData = createSimpleBLP(icon.imageData);
          const base64Data = btoa(String.fromCharCode(...blpData));
          
          // Upload to server
          const response = await fetch('/api/upload-icon', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: icon.name,
              blpData: base64Data
            })
          });
          
          if (response.ok) {
            uploaded++;
          } else {
            failed++;
            console.error(`Failed to upload ${icon.name}:`, await response.text());
          }
        } catch (err) {
          failed++;
          console.error(`Upload error for ${icon.name}:`, err);
        }
      }
      
      setError(null);
      alert(`Upload complete!\n✓ ${uploaded} icons uploaded\n✗ ${failed} failed\n\nThumbnails will be generated automatically.`);
      
      // Reload icons list after upload
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleBatchConvert = async () => {
    if (importedIcons.length === 0) {
      setError("No icons to convert");
      return;
    }
    try {
      const blpFiles: Array<{ name: string; data: Uint8Array }> = [];
      const newRecords: SpellIconRecord[] = [];
      for (let i = 0; i < importedIcons.length; i++) {
        const icon = importedIcons[i];
        const blpData = createSimpleBLP(icon.imageData);
        blpFiles.push({ name: `${icon.name}.blp`, data: blpData });
        newRecords.push({ id: existingDBC.length + i, iconPath: icon.name });
      }
      const mergedRecords = [...existingDBC, ...newRecords];
      const dbcContent = generateSpellIconDBC(mergedRecords);
      downloadFile(dbcContent, "SpellIcon.dbc", "application/octet-stream");
      for (const blp of blpFiles) {
        downloadFile(blp.data, blp.name, "application/octet-stream");
      }
      setError(null);
      alert(`Successfully converted ${importedIcons.length} icons!\nMerged with ${existingDBC.length} existing icons.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const PAGE_SIZE = 200;

  const filteredIcons = useMemo(
    () => {
      const term = searchTerm.trim().toLowerCase();
      const shouldShowInitialEmpty = !term && quickFilter === "all";
      if (shouldShowInitialEmpty) return [];

      return icons
        .filter((icon) => {
          const matchesSearch = !term || icon.toLowerCase().includes(term);
          if (!matchesSearch) return false;
          if (quickFilter === "all") return true;
          return getIconQuickBucket(icon) === quickFilter;
        })
        .sort();
    },
    [icons, quickFilter, searchTerm]
  );

  const totalPages = Math.max(1, Math.ceil(filteredIcons.length / PAGE_SIZE));
  const pagedIcons = useMemo(() => {
    const page = Math.min(currentPage, totalPages);
    const start = (page - 1) * PAGE_SIZE;
    return filteredIcons.slice(start, start + PAGE_SIZE);
  }, [filteredIcons, currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, quickFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const extractNamingPatterns = (names: string[]): string[] => {
    const patterns = new Map<string, number>();
    names.forEach((name) => {
      const parts = name.split("_");
      if (parts.length >= 2) {
        const pattern = parts.slice(0, -1).join("_") + "_";
        patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
      }
    });
    return Array.from(patterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pattern]) => pattern);
  };

  const applyNamingPattern = (pattern: string) => {
    setImportedIcons((prev) =>
      prev.map((icon, idx) => ({
        ...icon,
        name: `${pattern}${idx + 1}`.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      }))
    );
  };

  const toggleUnmappedSelection = (iconName: string) => {
    setSelectedUnmapped((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(iconName)) {
        newSet.delete(iconName);
      } else {
        newSet.add(iconName);
      }
      return newSet;
    });
  };

  const addSelectedToDBC = () => {
    if (selectedUnmapped.size === 0) {
      alert("No icons selected");
      return;
    }
    const maxId = Math.max(0, ...existingDBC.map(r => r.id));
    const newRecords: SpellIconRecord[] = Array.from(selectedUnmapped).map((iconName, idx) => ({
      id: maxId + idx + 1,
      iconPath: iconName.replace(/\.blp$/i, ''), // Remove .blp extension for DBC
    }));
    const mergedRecords = [...existingDBC, ...newRecords];
    const dbcContent = generateSpellIconDBC(mergedRecords);
    
    // Save to file for manual export
    downloadFile(dbcContent, "SpellIcon_Custom.dbc", "application/octet-stream");
    
    const dbcPath = config?.paths.base.dbc || 'dbc';
    const iconPath = config?.paths.base.icons || 'icon';
    alert(
      `✓ Added ${selectedUnmapped.size} new icons to DBC!\n\n` +
      `Total icons in new DBC: ${mergedRecords.length}\n` +
      `New IDs: ${maxId + 1} - ${maxId + selectedUnmapped.size}\n\n` +
      `File saved as: SpellIcon_Custom.dbc\n` +
      `Copy ${dbcPath}/ to your client DBFilesClient and ${iconPath}/ to Interface/Icons.`
    );
    
    // Update state to reflect new DBC
    setExistingDBC(mergedRecords);
    setUnmappedIcons(prev => prev.filter(icon => !selectedUnmapped.has(icon)));
    setSelectedUnmapped(new Set());
  };

  return (
    <div style={{ padding: "16px", color: textColor }}>
      <h2 style={{ textAlign: "left", color: textColor }}>Spell Icon Editor</h2>
      
      <div style={{ marginBottom: "20px", display: "flex", gap: "8px" }}>
        <button
          onClick={() => setMode("browse")}
          style={{
            padding: "10px 16px",
            backgroundColor: mode === "browse" ? "#007bff" : "#ccc",
            color: mode === "browse" ? "#fff" : "#000",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          Browse Icons
        </button>
        <button
          onClick={() => setMode("create")}
          style={{
            padding: "10px 16px",
            backgroundColor: mode === "create" ? "#28a745" : "#ccc",
            color: mode === "create" ? "#fff" : "#000",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          Add New Icons
        </button>
      </div>

      {error && (
        <div style={{ color: "red", marginBottom: "16px", padding: "10px", backgroundColor: "#ffe7e7", borderRadius: "4px" }}>
          Error: {error}
        </div>
      )}

      {mode === "browse" && (
        <div>
          <h3 style={{ textAlign: "left" }}>Spell Icons ({filteredIcons.length})</h3>
          <p style={{ fontSize: "14px", color: "#666" }}>Search or choose a class/profession filter to load icons.</p>

          <div style={{ marginBottom: "12px" }}>
            <input
              type="text"
              placeholder="Search icons (name/spec/profession)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                padding: "8px",
                borderRadius: "4px",
                border: "1px solid #ccc",
                width: "100%",
                fontSize: "14px",
              }}
            />
          </div>

          <div style={{ marginBottom: "12px", display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
            <button
              onClick={() => setQuickFilter("all")}
              style={{
                padding: "6px 10px",
                borderRadius: "16px",
                border: "1px solid #cbd5e1",
                backgroundColor: quickFilter === "all" ? "#2563eb" : "#fff",
                color: quickFilter === "all" ? "#fff" : "#1e293b",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              All
            </button>
            <button
              onClick={() => setQuickFilter("misc")}
              style={{
                padding: "6px 10px",
                borderRadius: "16px",
                border: "1px solid #cbd5e1",
                backgroundColor: quickFilter === "misc" ? "#2563eb" : "#fff",
                color: quickFilter === "misc" ? "#fff" : "#1e293b",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Misc
            </button>

            <select
              value={CLASS_FILTERS.some((cls) => cls.key === quickFilter) ? quickFilter : ""}
              onChange={(e) => {
                const value = e.target.value as ClassKey | "";
                setQuickFilter(value || "all");
              }}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontSize: "12px",
                minWidth: "180px",
              }}
            >
              <option value="">Class: Any</option>
              {CLASS_FILTERS.map((cls) => (
                <option key={cls.key} value={cls.key}>
                  {cls.icon} {cls.label}
                </option>
              ))}
            </select>

            <select
              value={PROF_FILTERS.some((prof) => prof.key === quickFilter) ? quickFilter : ""}
              onChange={(e) => {
                const value = e.target.value as ProfessionKey | "";
                setQuickFilter(value || "all");
              }}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontSize: "12px",
                minWidth: "200px",
              }}
            >
              <option value="">Profession: Any</option>
              {PROF_FILTERS.map((prof) => (
                <option key={prof.key} value={prof.key}>
                  {prof.icon} {prof.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: "12px", display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={regenerateThumbnails}
              disabled={thumbRebuilding}
              style={{
                padding: "8px 12px",
                backgroundColor: thumbRebuilding ? "#cbd5e1" : "#0ea5e9",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: thumbRebuilding ? "not-allowed" : "pointer",
                fontSize: "13px",
                fontWeight: "bold",
              }}
            >
              {thumbRebuilding ? "Rebuilding..." : "Regenerate Thumbnails"}
            </button>
            {thumbStatus && (
              <span style={{ fontSize: "12px", color: "#334155" }}>{thumbStatus}</span>
            )}
          </div>

          {filteredIcons.length > 0 && (
            <div style={{ marginBottom: "8px", padding: "8px 12px", border: "1px solid #eee", borderRadius: "4px", fontSize: "12px", color: "#64748b", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fff" }}>
              <span>
                Showing {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filteredIcons.length)} of {filteredIcons.length}
              </span>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  style={{
                    padding: "4px 8px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    backgroundColor: currentPage <= 1 ? "#f1f5f9" : "#fff",
                    color: "#334155",
                    cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                    fontSize: "12px",
                  }}
                >
                  Prev
                </button>
                <span>Page {currentPage}/{totalPages}</span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  style={{
                    padding: "4px 8px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "4px",
                    backgroundColor: currentPage >= totalPages ? "#f1f5f9" : "#fff",
                    color: "#334155",
                    cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
                    fontSize: "12px",
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "4px",
              maxHeight: "600px",
              overflowY: "auto",
              backgroundColor: "#fff",
            }}
          >
            {filteredIcons.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#999" }}>
                {!searchTerm.trim() && quickFilter === "all"
                  ? "Start typing or click a class/profession/misc filter."
                  : "No icons found."}
              </div>
            ) : (
              pagedIcons.map((iconName) => (
                <div
                  key={iconName}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "8px 12px",
                    borderBottom: "1px solid #eee",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      width: "64px",
                      height: "64px",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                      overflow: "hidden",
                      flexShrink: 0,
                    }}
                  >
                    <img
                      src={getThumbnailUrl(iconName)}
                      alt={iconName}
                      loading="lazy"
                      style={{ width: "64px", height: "64px", objectFit: "cover" }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>
                      {iconName}
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>
                      {ensureBlpExtension(iconName)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {mode === "create" && (
        <>
          <p>Import images, convert to WoW BLP format, and generate/merge SpellIcon.dbc</p>

          <div style={{
            border: "1px solid #ddd",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "20px",
            backgroundColor: "#f5f5f5",
          }}>
            <h4>Step 1: Import Existing DBC (Optional)</h4>
            <p style={{ fontSize: "14px", color: "#666", margin: "0 0 12px 0" }}>
              Drag and drop your SpellIcon.dbc or click to browse
            </p>
            <div
              ref={dbcDragZoneRef}
              onDragOver={handleDBCDragOver}
              onDragLeave={handleDBCDragLeave}
              onDrop={handleDBCDrop}
              onClick={() => dbcInputRef.current?.click()}
              style={{
                border: "2px dashed #0056b3",
                borderRadius: "8px",
                padding: "20px",
                textAlign: "center",
                backgroundColor: "#f9f9f9",
                cursor: "pointer",
                transition: "background-color 0.2s",
                marginBottom: "12px",
              }}
            >
              <p style={{ margin: "0", fontSize: "14px", color: "#666" }}>
                Drop DBC file here or click to browse
              </p>
            </div>
            <input
              ref={dbcInputRef}
              type="file"
              accept=".dbc"
              onChange={(e) => e.target.files?.[0] && handleDBCImport(e.target.files[0])}
              style={{ display: "none" }}
            />
            
            {dbcLoading && (
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "14px", marginBottom: "6px" }}>Importing DBC...</div>
                <div style={{
                  width: "100%",
                  height: "4px",
                  backgroundColor: "#ddd",
                  borderRadius: "2px",
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    backgroundColor: "#0056b3",
                    animation: "progress 1.5s ease-in-out infinite",
                  }} />
                </div>
              </div>
            )}

            {existingDBC.length > 0 && (
              <div style={{ fontSize: "14px", color: "#333", marginTop: "12px" }}>
                <strong>{existingDBC.length}</strong> icons loaded from DBC
              </div>
            )}
          </div>

          {existingDBC.length > 0 && importedIcons.length > 0 && (
            <div style={{
              border: "1px solid #ddd",
              borderRadius: "8px",
              padding: "16px",
              marginBottom: "20px",
              backgroundColor: "#f0f8ff",
            }}>
              <h4>Icon Comparison</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", fontSize: "14px" }}>
                <div>
                  <strong>Existing Icons:</strong>
                  <ul style={{ fontSize: "12px", maxHeight: "150px", overflowY: "auto" }}>
                    {Array.from(dbcCompare.existing).slice(0, 10).map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                    {dbcCompare.existing.size > 10 && <li>... and {dbcCompare.existing.size - 10} more</li>}
                  </ul>
                </div>
                <div>
                  <strong>New Icons to Add:</strong>
                  <ul style={{ fontSize: "12px", maxHeight: "150px", overflowY: "auto" }}>
                    {Array.from(dbcCompare.new).map((name) => (
                      <li key={name} style={{ color: "#28a745" }}>+ {name}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div style={{
            border: "1px solid #ddd",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "20px",
            backgroundColor: "#f5f5f5",
          }}>
            <h4>Step 2: Import Icons</h4>
            {namingPatterns.length > 0 && (
              <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "#fff", borderRadius: "4px" }}>
                <p style={{ fontSize: "13px", color: "#666", margin: "0 0 8px 0", fontWeight: "500" }}>
                  💡 Auto-naming Patterns Detected (click to apply):
                </p>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {namingPatterns.map((pattern) => (
                    <button
                      key={pattern}
                      onClick={() => applyNamingPattern(pattern)}
                      style={{
                        padding: "6px 10px",
                        backgroundColor: "#e7f3ff",
                        border: "1px solid #0056b3",
                        borderRadius: "3px",
                        color: "#0056b3",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: "500",
                        transition: "all 0.2s",
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.backgroundColor = "#0056b3";
                        e.currentTarget.style.color = "#fff";
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.backgroundColor = "#e7f3ff";
                        e.currentTarget.style.color = "#0056b3";
                      }}
                    >
                      {pattern}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div
              ref={dragZoneRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                border: "2px dashed #007bff",
                borderRadius: "8px",
                padding: "40px",
                textAlign: "center",
                backgroundColor: "#f9f9f9",
                cursor: "pointer",
                transition: "background-color 0.2s",
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <p style={{ fontSize: "16px", color: "#666" }}>
                Drag and drop images here or click to browse
              </p>
              <p style={{ fontSize: "12px", color: "#999" }}>
                Supported: JPEG, PNG, BMP, GIF
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => e.target.files && handleFileImport(e.target.files)}
              style={{ display: "none" }}
            />
          </div>

          {importedIcons.length > 0 && (
            <div style={{
              padding: "12px",
              backgroundColor: "#e8f5e9",
              border: "1px solid #4caf50",
              borderRadius: "4px",
              marginBottom: "16px",
              fontSize: "14px",
              color: "#2e7d32",
            }}>
              📦 Ready for Conversion: <strong>{importedIcons.length}</strong> image{importedIcons.length !== 1 ? "s" : ""} cached
            </div>
          )}

          {importedIcons.length > 0 && (
            <>
              <h4>Step 3: Configure Icons ({importedIcons.length})</h4>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: "16px",
                marginBottom: "20px",
              }}>
                {importedIcons.map((icon) => (
                  <div key={icon.id} style={{
                    border: "1px solid #ddd",
                    borderRadius: "8px",
                    padding: "12px",
                    backgroundColor: "#fff",
                  }}>
                    <img
                      src={icon.preview}
                      alt={icon.name}
                      style={{
                        width: "100%",
                        height: "80px",
                        objectFit: "contain",
                        marginBottom: "8px",
                        backgroundColor: "#000",
                      }}
                    />
                    <input
                      type="text"
                      value={icon.name}
                      onChange={(e) => updateIconName(icon.id, e.target.value)}
                      style={{
                        width: "100%",
                        padding: "6px",
                        marginBottom: "8px",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                        fontSize: "12px",
                        boxSizing: "border-box",
                      }}
                    />
                    <div style={{ marginBottom: "8px", fontSize: "12px" }}>
                      <label style={{ marginRight: "8px" }}>
                        <input
                          type="radio"
                          name={`size_${icon.id}`}
                          value="32"
                          checked={icon.size === 32}
                          onChange={() => updateIconSize(icon.id, 32)}
                        />
                        32x32
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`size_${icon.id}`}
                          value="64"
                          checked={icon.size === 64}
                          onChange={() => updateIconSize(icon.id, 64)}
                        />
                        64x64
                      </label>
                    </div>
                    <button
                      onClick={() => removeIcon(icon.id)}
                      style={{
                        width: "100%",
                        padding: "6px",
                        backgroundColor: "#dc3545",
                        color: "#fff",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "12px",
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                <button
                  onClick={handleBatchConvert}
                  style={{
                    padding: "12px 24px",
                    backgroundColor: "#28a745",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "16px",
                    fontWeight: "bold",
                  }}
                >
                  Convert & Download
                </button>
                <button
                  onClick={handleUploadToServer}
                  style={{
                    padding: "12px 24px",
                    backgroundColor: "#007bff",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "16px",
                    fontWeight: "bold",
                  }}
                >
                  Upload to Server
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

function createSimpleBLP(imageData: ImageData): Uint8Array {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  
  // BLP header (156 bytes)
  const header = new Uint8Array(156);
  const view = new DataView(header.buffer);
  
  // Magic: "BLP1"
  header[0] = 0x42; // B
  header[1] = 0x4c; // L
  header[2] = 0x50; // P
  header[3] = 0x31; // 1
  
  // Compression type: 1 = uncompressed
  view.setUint32(4, 1, true);
  
  // Flags and alpha
  header[8] = 3;  // Alpha bit depth
  header[9] = 8;  // Alpha encoding
  header[10] = 7; // Has mipmaps
  header[11] = 1; // Extra?
  
  // Dimensions
  view.setUint32(12, width, true);
  view.setUint32(16, height, true);
  
  // Mipmap offsets and sizes (only 1 mipmap at offset 156)
  view.setUint32(20, 156, true);  // Mipmap 0 offset
  view.setUint32(24, 0, true);    // Mipmap 1 offset (none)
  
  // Mipmap sizes
  const pixelDataSize = width * height * 4;
  view.setUint32(100, pixelDataSize, true);  // Mipmap 0 size
  
  // Convert RGBA to BGRA (swap red and blue channels)
  const bgra = new Uint8Array(pixelDataSize);
  for (let i = 0; i < data.length; i += 4) {
    bgra[i]     = data[i + 2]; // B
    bgra[i + 1] = data[i + 1]; // G
    bgra[i + 2] = data[i];     // R
    bgra[i + 3] = data[i + 3]; // A
  }
  
  // Combine header + pixel data
  const result = new Uint8Array(156 + pixelDataSize);
  result.set(header);
  result.set(bgra, 156);
  return result;
}

function generateSpellIconDBC(records: SpellIconRecord[]): Uint8Array {
  const header = new Uint8Array(20);
  const headerView = new DataView(header.buffer);
  header[0] = 87;
  header[1] = 68;
  header[2] = 66;
  header[3] = 67;
  const fieldCount = 2;
  const recordCount = records.length;
  const fieldSize = fieldCount * 4;
  const stringBlockSize = 1;
  headerView.setUint32(4, fieldCount, true);
  headerView.setUint32(8, recordCount, true);
  headerView.setUint32(12, fieldSize, true);
  headerView.setUint32(16, stringBlockSize, true);
  const recordBuffer = new Uint32Array(recordCount * fieldCount);
  records.forEach((record, i) => {
    recordBuffer[i * fieldCount] = record.id;
    recordBuffer[i * fieldCount + 1] = 0;
  });
  const totalSize = header.length + recordBuffer.byteLength + stringBlockSize;
  const result = new Uint8Array(totalSize);
  result.set(header, 0);
  result.set(new Uint8Array(recordBuffer.buffer), header.length);
  return result;
}

function downloadFile(content: string | Uint8Array, filename: string, mimeType: string): void {
  const arr = content instanceof Uint8Array ? [content] : [content];
  // @ts-ignore - BlobPart type compatibility at runtime
  const blob = new Blob(arr, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// CSS for loading animation
const styles = `
  @keyframes progress {
    0% { width: 0%; }
    50% { width: 70%; }
    100% { width: 100%; }
  }
`;

if (!document.querySelector('style[data-spell-icon-editor]')) {
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-spell-icon-editor', 'true');
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);
}

export default SpellIconEditor;
