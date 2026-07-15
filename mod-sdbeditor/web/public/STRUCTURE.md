# SDBEditor Asset Management Structure

## Folder Organization

```
public/
├── dbc/                          # Original WoW DBC files (read-only)
├── Icons/                        # Original WoW game icons (read-only + uploads)
│
├── ../export/                    # Export outputs for MPQ patching
│   ├── Interface/
│   │   └── Icons/               # Exported BLP icon files
│   └── DBFilesClient/            # Exported DBC database files
│
├── class-icons/                  # WoW class selection icons (UI)
├── class-backgrounds/            # Talent tree spec backgrounds (UI)
└── talent-icons/                 # Individual talent ability icons (UI)
```

## File Types

### DBC Files (Database)
- **Location**: `dbc/` (base sync from server)
- **Format**: Raw DBC binary format
- **Export Path**: `../export/DBFilesClient/`
- **Use**: Place directly in client `DBFilesClient/` folder
- **Examples**: `Spell.dbc`, `SpellIcon.dbc`, `Talent.dbc`

### Icon Files 
- **Location**: `Icons/` (base + uploads)
- **Formats**: 
  - **Input**: PNG, JPG, BLP
  - **Output**: BLP (exported)
- **Export Path**: `../export/Interface/Icons/`
- **Use**: Place in client `Interface/Icons/` folder in MPQ patch
- **Naming**: Uploads are stored as `custom-<name>.blp` and exported as-is

## Workflow

### Adding New Icons
1. Upload PNG/JPG in Spell Icon Editor
2. Editor saves to `Icons/` with `custom-` prefix
3. When exporting, copies `custom-*` icons
4. BLP files output to `../export/Interface/Icons/`
5. Pack `export/Interface/Icons/` into MPQ patch

### Editing DBC Files
1. Sync server DBCs into `dbc/`
2. Edit via the DBC editors
3. Edits are written to `export/DBFilesClient/`
4. Place `../export/DBFilesClient/*` files in client `DBFilesClient/` folder

### Initial Setup
1. Sync server DBCs to `dbc/` via SettingsPanel
2. Upload icons into `Icons/` via the Spell Icon Editor
3. Export when ready to patch

## API Endpoints

### Copy Files (SettingsPanel - Initial Setup)
 - `POST /api/import-server-dbc` - Sync server DBCs into `public/dbc`

### Export Icons (SettingsPanel - Asset Export)
- `POST /api/export-icons` - Copy and export custom icons
  - Action: Reads `public/Icons/custom-*`, copies to `../export/Interface/Icons/`
  - Response: Count of exported files
  - UI: Orange button in Settings panel
  - Example: `custom-foo.blp` → `custom-foo.blp` in ../export/Interface/Icons/

### Export DBCs (SettingsPanel - Asset Export)
- `POST /api/export-dbc` - Export edited DBCs from export folder
  - Action: Reads from `../export/DBFilesClient/` (edited output)
  - Preserves original DBC file names
  - Response: Count of exported files with sizes
  - UI: Orange button in Settings panel
  - Example: `Spell.dbc` → `Spell.dbc` in export/DBFilesClient/

### Export Status (SettingsPanel - Monitoring)
- `GET /api/export-status` - Get current export folder contents
  - Response: File counts and lists for both icons and DBCs
  - Auto-refreshes after each export
  - Shows green status indicator when files are present

## File Size Notes
- **Icons folder**: Contains 45,000+ game icons (~300MB+)
- **DBC folder**: Contains ~150 DBC files (~50MB)
- Only edited files in `export/` need to be packed for patches
- Export folder structures match client folder layout (Interface/Icons, DBFilesClient)

## UI Components

### SettingsPanel Export Section
- Located in Settings tab (⚙️ Show Settings)
- Two orange export buttons: "Export Icons" and "Export DBCs"
- Real-time status showing exported file counts
- Green status box when export contains files
- Disabled during export with "Exporting..." label
