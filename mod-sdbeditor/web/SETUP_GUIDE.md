# WoW 3.3.5 Icon Editor - Setup Guide

Working directory for this module:

```bash
cd /root/azerothcore-wotlk/modules/mod-sdbeditor/web
```

## Directory Structure

The application keeps base data in public folders and writes edits to export folders:

```
public/
├── dbc/                        # DBC files synced from the server
├── Icons/                      # Icon BLP files (uploads stored as custom-*)
../export/
├── Interface/Icons/            # Exported icon files
└── DBFilesClient/              # Exported DBC files
```

## Initial Setup

### Step 1: Sync Server DBCs
1. Launch the application
2. Click **⚙️ Settings**
3. Click **Sync DBC Files** to copy from the server data folder into `public/dbc/`

### Step 2: Upload Icons
1. Open the Spell Icon Editor
2. Upload BLP files to add icons
3. Uploaded icons are stored as `custom-*.blp` in `public/Icons/`

## Workflow

### Browsing Icons
1. Open **Browse Icons** mode
2. The icon list is built from `public/Icons/`
3. Thumbnails are generated into `public/thumbnails/`

### Adding Custom Icons
1. Use **Add New Icons** mode
2. Upload BLP files
3. The server mirrors them to `export/Interface/Icons/`
4. SpellIcon.dbc updates are written to `export/DBFilesClient/`

### Client Deployment
1. Copy `export/DBFilesClient/*.dbc` → `<Client>/DBFilesClient/`
2. Copy `export/Interface/Icons/*.blp` → `<Client>/Interface/Icons/`
3. Distribute via MPQ patch if needed

## Configuration File

Located at `public/config.json`:

Custom paths are kept for backward compatibility but are no longer used.

```json
{
  "paths": {
    "base": {
      "dbc": "dbc",
      "icons": "Icons"
    },
    "custom": {
      "dbc": "custom-dbc",
      "icons": "custom-icon"
    }
  },
  "settings": {
    "activeDBCSource": "base",
    "activeIconSource": "base",
    "allowBaseModification": false
  }
}
```

## Safety Features

- **Base Sync**: Server data is copied into `public/dbc` to avoid corruption
- **Export Outputs**: All edits are written to `export/` only
- **Auto-Detection**: Unmapped icons are detected automatically

## Tips

- Keep `public/dbc` synced when server data changes
- Use `custom-*` icon names for new uploads
- Test icons in-game before deploying to players
