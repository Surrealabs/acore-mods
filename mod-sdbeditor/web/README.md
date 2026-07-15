# WoW 3.3.5 Spell Icon Editor (SDBEditor)

A modern web-based editor for managing World of Warcraft 3.3.5 (WotLK) spell icons. Create custom spell icons, manage icon databases, and generate expanded DBC files for private servers.

## Features

- 🎨 **Browse Icons** - View spell icons from the public Icons folder
- ✨ **Create Icons** - Import images and convert them to BLP format
- 📊 **DBC Management** - Load, parse, and expand SpellIcon.dbc files
- 🔍 **Icon Detection** - Automatically identify new custom icons vs base WotLK icons
- 💾 **DBC Export** - Generate new DBC files with custom icon IDs
- 📦 **File Organization** - Keep base files in public and write edits to export
- 🖥️ **Modern UI** - React 18 + TypeScript with real-time image preview
- ⚡ **Fast Processing** - Vite dev server with HMR for instant updates

## Technology Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Node.js + Express
- **Binary Formats**: DBC (database), BLP (WoW image format)
- **Image Processing**: Canvas API with BLP encoder/decoder

## Quick Start

```bash
# From your AzerothCore repo
cd /root/azerothcore-wotlk/modules/mod-sdbeditor/web

# Install dependencies
npm install

# Generate base icons manifest
node generate-icon-manifest.js
```

## One-Command Install (Linux)

```bash
cd /root/azerothcore-wotlk/modules/mod-sdbeditor
sudo bash install.sh
```

This installs Node.js (LTS), runs `npm install`, and starts:

- Starter service (port 5000)
- File service (port 3001)
- Web UI (port 5173)

Open the setup page at:

```
http://<server-ip>:5000
```

### Run Development Servers

**Terminal 1 - Frontend**
```bash
npm run dev
# Opens http://localhost:5173
```

**Terminal 2 - Backend**
```bash
npm run server
# File service runs on http://localhost:3001
```

**Terminal 3 - Starter Service**
```bash
npm run starter
# Server control API on http://localhost:5000
```

## Folder Structure

```
modules/mod-sdbeditor/web/
├── public/
│   ├── dbc/                    # DBC files synced from the server
│   ├── Icons/                  # Icon BLP files (uploads stored as custom-*)
│   ├── export/
│   │   ├── DBFilesClient/       # Edited DBC outputs
│   │   └── Interface/Icons/     # Exported icon outputs
│   └── base-icons-manifest.json # Auto-generated manifest of base icons
├── src/
│   ├── components/
│   │   ├── SpellIconEditor.tsx  # Main editor component (~1000 lines)
│   │   └── SettingsPanel.tsx    # Initial setup & file management
│   ├── lib/
│   │   ├── dbc-parser.ts        # Binary DBC format parser
│   │   ├── blpconverter.js # BLP image codec
│   │   └── config.ts            # Configuration & path management
│   └── App.tsx
├── server.js                     # Express backend for file operations
├── generate-icon-manifest.js     # Utility to scan base icons
├── package.json
└── vite.config.ts
```

## Workflow

### 1. Initial Setup (Auto-detects missing files)
- Click **"Sync DBC Files"** → Copies server DBCs into public/dbc/
- Upload icons in the Spell Icon Editor (saved as custom-* in public/Icons/)

### 2. Browse Icons
- Shows all icons in public/Icons/
- Import a SpellIcon.dbc file to see icon ID mappings
- Lists unmapped icons (in folder but not in DBC)
- **Highlights NEW icons** (not in base WotLK)

### 3. Add New Icons
- Drag & drop or select image files (JPEG, PNG, BMP, GIF)
- Automatic resize to 64x64 pixels
- Converts to BLP format with preview
- Select which icons to add to your export SpellIcon.dbc
- Generates **SpellIcon_Custom.dbc** with new icon IDs

### 4. Export & Deploy
- Download SpellIcon_Custom.dbc (contains only new icons)
- Copy ../export/DBFilesClient/ to your client DBFilesClient/ and ../export/Interface/Icons/ to Interface/Icons/
- Merge DBC files with your server's existing databases

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/import-server-dbc` | POST | Sync server DBCs into public/dbc |
| `/api/check-files` | GET | Check if DBCs/icons exist in public folders |
| `/api/upload-icon` | POST | Store uploaded BLP icon data |
| `/api/export-dbc` | POST | Export modified DBC file |

## Starter Service (Server Control)

The starter service runs separately on port 5000 and uses the auth database
for admin login. It stores local settings in `web/starter-config.json`.

Initial config (POST):

```json
{
  "db": {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "webmin",
    "password": "YOUR_PASSWORD",
    "database": "acore_auth"
  },
  "paths": {
    "acoreRoot": "/root/azerothcore-wotlk",
    "authBin": "/root/azerothcore-wotlk/env/dist/bin/authserver",
    "worldBin": "/root/azerothcore-wotlk/env/dist/bin/worldserver",
    "armoryBin": "",
    "logsDir": "/tmp"
  },
  "security": {
    "adminMinLevel": 3
  }
}
```

Endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/starter/health` | GET | Check if config exists |
| `/api/starter/config` | POST | Save config to `starter-config.json` |
| `/api/starter/login` | POST | Login via auth DB account + GM level |
| `/api/starter/servers/status` | GET | Server status (auth/world/armory) |
| `/api/starter/servers/start` | POST | Start server (auth/world/armory) |
| `/api/starter/servers/stop` | POST | Stop server (auth/world/armory) |
| `/api/starter/servers/restart` | POST | Restart server (auth/world/armory) |

## Icon Comparison

The app uses **base-icons-manifest.json** to compare:

- **Base WotLK**: 6,308 icons from INT_335_wotlk/Icons/
- **Custom Icons**: Any `custom-*` BLP file in public/Icons
- **DBC Entries**: Icon IDs from SpellIcon.dbc

This lets you easily identify which icons are genuinely new additions vs standard WotLK icons.

## Building for Production

```bash
npm run build
# Creates optimized dist/ folder for deployment

npm run preview
# Test production build locally
```

## Development Notes

- BLP codec supports WoW BLP1 and BLP2 formats
- DBC parser handles SpellIcon.dbc binary format
- Config system uses public base paths with export-only edits
- Image resizing uses Canvas API (64x64 target)
- Backend uses Express with file system operations

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "File not found" errors | Ensure DBC_335_wotlk/ and INT_335_wotlk/ exist, then run `generate-icon-manifest.js` |
| Backend not responding | Confirm `npm run server` is running; check port 3001 is free |
| BLP conversion errors | Ensure images are RGB/RGBA; 64x64+ recommended |
| Icons not showing | Hard refresh browser (Ctrl+Shift+R); check browser DevTools console |

## License

MIT License - Free for personal and commercial use

## Contributing

Pull requests welcome! Areas for improvement:
- Support for other DBC types (creatures, items, etc.)
- Batch icon processing with progress bars
- Icon preview with animations
- Server-side BLP conversion using native libraries

## Support

- 📝 [Issues](https://github.com/yourusername/wow-spell-icon-editor/issues)
- 💬 [Discussions](https://github.com/yourusername/wow-spell-icon-editor/discussions)
- 🎮 Compatible with WoW 3.3.5 private servers (Trinity Core, MaNGOS, etc.)
- Make DBC editing accessible and visual for everyone
- Remove the need for Windows-only tools or manual hex editing
- Support for all major DBCs used in WotLK private servers
- Easy import/export and batch editing
- Ready for both local and server-hosted use

## Usage
1. Install dependencies: `npm install`
2. Start the app: `npm run dev`
3. Open [http://localhost:5173](http://localhost:5173) in your browser
4. Use the tabs to edit talents, spell icons, and more

## Folder Structure
- `src/components/` — React components for each editor
- `src/types/` — TypeScript interfaces for DBC structures
- `public/` — Place default DBC files and assets here
- `interface/` — Place BLP icon files here for use in the app

## Contributing
Pull requests and suggestions are welcome!
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
