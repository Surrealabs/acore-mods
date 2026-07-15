# Export System Implementation

## Overview

The export system allows users to convert custom-modified DBC files and icons into an MPQ-patch-ready directory structure. The workflow is:

1. **Upload** → Files go to `custom-*` folders
2. **Edit** → Users modify files as needed
3. **Export** → Files copied/converted to `export/` structure
4. **Package** → `export/` folder ready for MPQ creation

## Components Implemented

### Backend (server.js)

#### 1. POST /api/export-icons
```javascript
Endpoint: POST /api/export-icons
Location: server.js, line 365
Purpose: Copy custom icons from custom-icons/ to export/Interface/Icons/
Actions:
  - Reads all .png, .jpg, .jpeg, .blp files from custom-icons/
  - Copies each file to export/Interface/Icons/
  - Renames with .blp extension (test-icon.png → test-icon.blp)
  - Returns count of files exported
Response: 
  {
    success: true,
    message: "Exported X icons",
    exported: ["file1.png", "file2.jpg"],
    exportPath: "/export/Interface/Icons",
    note: "BLP conversion ready"
  }
```

#### 2. POST /api/export-dbc
```javascript
Endpoint: POST /api/export-dbc
Location: server.js, line 428
Purpose: Copy custom DBC files to export/DBFilesClient/
Actions:
  - Reads all .dbc files from custom-dbc/
  - Copies each file to export/DBFilesClient/
  - Preserves original DBC filenames
  - Returns count and size of files exported
Response:
  {
    success: true,
    message: "Exported X DBC files",
    exported: [
      { file: "Spell.dbc", size: 12345 },
      { file: "SpellIcon.dbc", size: 67890 }
    ],
    exportPath: "/export/DBFilesClient",
    note: "Ready for DBFilesClient/ folder"
  }
```

#### 3. GET /api/export-status
```javascript
Endpoint: GET /api/export-status
Location: server.js, line 485
Purpose: Get current contents of export folders
Actions:
  - Lists files in export/Interface/Icons/
  - Lists files in export/DBFilesClient/
  - Returns file counts (useful for UI indicators)
Response:
  {
    success: true,
    icons: {
      count: 5,
      files: ["icon1.blp", "icon2.blp", ...],
      hasMore: false
    },
    dbcs: {
      count: 3,
      files: ["Spell.dbc", "Talent.dbc", "SpellIcon.dbc"]
    },
    exportPaths: {
      icons: "/export/Interface/Icons",
      dbcs: "/export/DBFilesClient"
    }
  }
```

### Frontend (SettingsPanel.tsx)

#### State Management
```typescript
- exporting: 'icons' | 'dbc' | null  // Track which export is running
- exportStatus: ExportStatus | null   // Store export folder contents
```

#### Functions

**refreshExportStatus()**
- Called on component mount
- Called after each export
- Fetches GET /api/export-status
- Updates UI with file counts

**exportIcons()**
- Posts to POST /api/export-icons
- Shows "Exporting..." while running
- Calls refreshExportStatus on success
- Shows alert with result count
- Disables button during operation (opacity 0.6)

**exportDbc()**
- Posts to POST /api/export-dbc
- Shows "Exporting..." while running
- Calls refreshExportStatus on success
- Shows alert with result count
- Disables button during operation (opacity 0.6)

#### UI Components

**Export Icons Button**
- Color: Orange (#ff9800)
- Location: Settings panel, Export Files section
- Label: "Export Icons" or "Exporting..." when active
- Shows count of exported files below button
- Real-time status update after export

**Export DBC Button**
- Color: Orange (#ff9800)
- Location: Settings panel, Export Files section
- Label: "Export DBCs" or "Exporting..." when active
- Shows count of exported files below button
- Real-time status update after export

**Export Status Box**
- Color: Green (#4caf50) with 10% opacity background
- Appears only when export folders have content
- Shows count of files in Interface/Icons and DBFilesClient
- Uses monospace font for file paths

## File Structure

### Input Folders
```
custom-icons/          # User uploads PNG, JPG files here
custom-dbc/            # User uploads DBC files here
```

### Output Folders
```
export/
├── Interface/
│   └── Icons/        # Output: PNG/JPG get .blp extension
└── DBFilesClient/    # Output: Raw DBC files preserved
```

## Usage Flow

### Exporting Icons
1. User uploads PNG/JPG to Spell Icon Editor → saved to `custom-icons/`
2. User clicks "⚙️ Show Settings"
3. User clicks orange "Export Icons" button
4. Backend copies from `custom-icons/` to `export/Interface/Icons/`
5. Files renamed to .blp extension
6. Green status box shows "✓ Icon files: 5 file(s)"

### Exporting DBCs
1. User uploads DBC to Talent/Spell Editor → saved to `custom-dbc/`
2. User clicks "⚙️ Show Settings"
3. User clicks orange "Export DBCs" button
4. Backend copies from `custom-dbc/` to `export/DBFilesClient/`
5. Filenames preserved (e.g., Spell.dbc stays as Spell.dbc)
6. Green status box shows "✓ DBC files: 3 file(s)"

## Testing

### Manual Test Files
Created for verification:
- `/public/custom-icons/test-icon.png` - Test icon file
- `/public/custom-dbc/test.dbc` - Test DBC file

### Verification Steps
1. Ensure servers running (npm run server on port 3001)
2. Open Settings panel (⚙️ button)
3. Click "Export Icons" → should see files in export/Interface/Icons/
4. Click "Export DBCs" → should see files in export/DBFilesClient/
5. Verify export status shows correct file counts

## Future Enhancements

### Planned Features
- [ ] Real BLP format conversion (currently just renames to .blp)
- [ ] Zip download of export/ folder for easy distribution
- [ ] Clear export folder button for cleanup
- [ ] Individual file delete from export folders
- [ ] Progress indicator for large exports
- [ ] Selective export (choose specific files)
- [ ] MPQ packaging directly from export/
- [ ] File validation before export

### Integration Points
- **Spell Icon Editor**: Should trigger auto-export when uploading icons
- **DBC Editors**: Should show export status next to save button
- **Download Feature**: Add button to download export/ as .zip
- **MPQ Tools**: Integration with stormlib or WoW patch tools

## Error Handling

All endpoints return proper error responses:
```javascript
{
  error: "Error describing what went wrong"
}
```

Common errors:
- Missing custom-dbc or custom-icons folder (auto-created)
- File read/write permissions
- Disk full
- Invalid file format (filtered at read time)

## Performance Considerations

- Icon exports: Fast, just copies files
- DBC exports: Fast, just copies files
- Large icon sets: May take a few seconds for 300MB+ folders
- Status check: Lightweight directory listing operation

## Integration with MPQ Workflow

The export/ folder structure mimics WoW client structure:
```
export/
├── Interface/
│   └── Icons/          # → dbClientPath.MPQ:Interface/Icons/
└── DBFilesClient/      # → dbClientPath.MPQ:DBFilesClient/
```

This allows direct zipping of export/ contents into MPQ patch format.

## Files Modified

1. **server.js**
   - Added 3 new endpoints (export-icons, export-dbc, export-status)
   - Added ExportStatus type definition (if TypeScript)
   - Error handling for export operations

2. **SettingsPanel.tsx**
   - Added ExportStatus type
   - Added exporting, exportStatus state
   - Added refreshExportStatus function
   - Added exportIcons function
   - Added exportDbc function
   - Added UI section with 2 orange buttons
   - Added status display showing exported file counts

3. **STRUCTURE.md**
   - Updated API endpoints documentation
   - Removed TODO markers
   - Added detailed endpoint descriptions
   - Added UI components section

## Deployment Notes

- No new npm dependencies added
- Uses built-in Node.js fs module for file operations
- Compatible with existing folder structure
- Backward compatible with current upload system
- Auto-creates missing export folders
