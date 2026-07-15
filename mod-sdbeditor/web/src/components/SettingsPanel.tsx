import React, { useState, useEffect } from 'react';
import { loadConfig, saveConfig, type AppConfig } from '../lib/config';

type ExportStatus = {
  icons: { count: number; files: string[]; hasMore?: boolean };
  dbcs: { count: number; files: string[] };
  exportPaths: { icons: string; dbcs: string };
};

type Props = {
  textColor?: string;
  contentBoxColor?: string;
};

const SettingsPanel: React.FC<Props> = ({ textColor = '#000', contentBoxColor = '#f9f9f9' }) => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [dbcCopied, setDbcCopied] = useState(false);
  const [iconsCopied, setIconsCopied] = useState(false);
  const [copying, setCopying] = useState<'dbc' | null>(null);
  const [exporting, setExporting] = useState<'icons' | 'dbc' | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig);
    checkFilesExist();
    refreshExportStatus();
  }, []);

  const refreshExportStatus = async () => {
    try {
      const response = await fetch('/api/export-status');
      if (response.ok) {
        const data = await response.json();
        setExportStatus(data);
      }
    } catch (error) {
      console.error('Error checking export status:', error);
    }
  };

  const checkFilesExist = async () => {
    try {
      const response = await fetch('/api/check-files');
      if (response.ok) {
        const data = await response.json();
        setDbcCopied(data.dbcExists);
        setIconsCopied(data.iconsExist);
      }
    } catch (error) {
      console.error('Error checking files:', error);
    }
  };

  const syncDbcFiles = async () => {
    if (!config) return;
    setCopying('dbc');
    try {
      const response = await fetch('/api/import-server-dbc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        setDbcCopied(true);
        alert('✓ DBC files synced from server successfully!');
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      alert('Backend server not running. Make sure to run: npm run server');
    } finally {
      setCopying(null);
      checkFilesExist();
    }
  };

  const allReady = dbcCopied;

  const exportIcons = async () => {
    setExporting('icons');
    try {
      const response = await fetch('/api/export-icons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const data = await response.json();
        alert(`✓ ${data.message}`);
        refreshExportStatus();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      alert('Backend server not running. Make sure to run: npm run server');
    } finally {
      setExporting(null);
    }
  };

  const exportDbc = async () => {
    setExporting('dbc');
    try {
      const response = await fetch('/api/export-dbc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const data = await response.json();
        alert(`✓ ${data.message}`);
        refreshExportStatus();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      alert('Backend server not running. Make sure to run: npm run server');
    } finally {
      setExporting(null);
    }
  };

  if (!config) return null;

  return (
    <div style={{ marginBottom: '20px' }}>
      {!allReady && (
        <div style={{
          border: `1px solid ${contentBoxColor}`,
          borderRadius: '8px',
          padding: '20px',
          backgroundColor: contentBoxColor,
          marginBottom: '16px',
          color: textColor,
        }}>
          <h3 style={{ marginTop: 0, textAlign: 'left', color: textColor }}>📋 Initial Setup Required</h3>
          <p style={{ fontSize: '14px', opacity: 0.8, marginBottom: '16px' }}>
            Sync server DBCs into the public folder. Icons are uploaded through the icon editor.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* DBC Sync Button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {dbcCopied ? (
                <>
                  <div style={{ fontSize: '24px' }}>✅</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', color: textColor }}>DBC Files Synced</div>
                    <div style={{ fontSize: '12px', opacity: 0.7 }}>DBC files ready in {config.paths.base.dbc}/</div>
                  </div>
                </>
              ) : (
                <>
                  <button
                    onClick={syncDbcFiles}
                    disabled={copying === 'dbc'}
                    style={{
                      padding: '10px 16px',
                      backgroundColor: '#9c27b0',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: copying === 'dbc' ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      opacity: copying === 'dbc' ? 0.6 : 1,
                      minWidth: '160px',
                    }}
                  >
                    {copying === 'dbc' ? 'Syncing...' : 'Sync DBC Files'}
                  </button>
                  <div style={{ flex: 1, fontSize: '12px', opacity: 0.7 }}>
                    Source: server data folder
                  </div>
                </>
              )}
            </div>

            {/* Icons Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '24px' }}>{iconsCopied ? '✅' : '📁'}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', color: textColor }}>Icons Folder</div>
                <div style={{ fontSize: '12px', opacity: 0.7 }}>Uploads go to {config.paths.base.icons}/ (custom-* names export)</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {allReady && (
        <>
          <div style={{
            marginBottom: '16px',
            padding: '16px',
            backgroundColor: contentBoxColor,
            border: `1px solid ${contentBoxColor}`,
            borderRadius: '8px',
            color: textColor,
            fontWeight: 'bold',
            textAlign: 'center',
          }}>
            ✅ Setup Complete! Ready to edit.
          </div>

          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              padding: '8px 16px',
              backgroundColor: contentBoxColor,
              color: textColor,
              border: `1px solid ${textColor}`,
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              marginBottom: showSettings ? '12px' : '0',
            }}
          >
            ⚙️ {showSettings ? 'Hide Settings' : 'Show Settings'}
          </button>

          {showSettings && (
            <div style={{
              border: `1px solid ${contentBoxColor}`,
              borderRadius: '8px',
              padding: '16px',
              backgroundColor: contentBoxColor,
              marginTop: '12px',
              color: textColor,
            }}>
              <h3 style={{ marginTop: 0, textAlign: 'left', color: textColor }}>Configuration</h3>

              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ textAlign: 'left', fontSize: '14px', marginBottom: '8px', color: textColor }}>DBC Source:</h4>
                <div style={{ fontSize: '12px', opacity: 0.7, paddingLeft: '4px' }}>
                  📁 {config.paths.base.dbc} (synced from server)
                </div>
                <div style={{ fontSize: '12px', opacity: 0.7, paddingLeft: '4px', marginTop: 4 }}>
                  ✎ Edits saved to export/DBFilesClient
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ textAlign: 'left', fontSize: '14px', marginBottom: '8px', color: textColor }}>Icon Source:</h4>
                <div style={{ fontSize: '12px', opacity: 0.7, paddingLeft: '4px' }}>
                  📁 {config.paths.base.icons} (uploads)
                </div>
                <div style={{ fontSize: '12px', opacity: 0.7, paddingLeft: '4px', marginTop: 4 }}>
                  ✎ Custom icons mirrored to export/Interface/Icons
                </div>
              </div>

              <hr style={{ borderColor: 'rgba(0,0,0,0.1)', margin: '20px 0' }} />

              <h3 style={{ marginTop: 0, textAlign: 'left', color: textColor }}>📦 Export Files</h3>
              <p style={{ fontSize: '14px', opacity: 0.8, marginBottom: '16px' }}>
                Export edited files to MPQ-ready format for distribution.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                {/* Export Icons Button */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    onClick={exportIcons}
                    disabled={exporting === 'icons'}
                    style={{
                      padding: '10px 16px',
                      backgroundColor: '#ff9800',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: exporting === 'icons' ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      opacity: exporting === 'icons' ? 0.6 : 1,
                      minWidth: '160px',
                    }}
                  >
                    {exporting === 'icons' ? 'Exporting...' : 'Export Icons'}
                  </button>
                  <div style={{ flex: 1, fontSize: '12px', opacity: 0.7 }}>
                    To: /root/azerothcore-wotlk/modules/mod-sdbeditor/export/Interface/Icons/
                    {exportStatus?.icons.count && exportStatus.icons.count > 0 && (
                      <div style={{ marginTop: '4px', color: '#4caf50', fontWeight: 'bold' }}>
                        ✓ {exportStatus.icons.count} file{exportStatus.icons.count !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                </div>

                {/* Export DBC Button */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    onClick={exportDbc}
                    disabled={exporting === 'dbc'}
                    style={{
                      padding: '10px 16px',
                      backgroundColor: '#ff9800',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: exporting === 'dbc' ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      opacity: exporting === 'dbc' ? 0.6 : 1,
                      minWidth: '160px',
                    }}
                  >
                    {exporting === 'dbc' ? 'Exporting...' : 'Export DBCs'}
                  </button>
                  <div style={{ flex: 1, fontSize: '12px', opacity: 0.7 }}>
                    To: /root/azerothcore-wotlk/modules/mod-sdbeditor/export/DBFilesClient/
                    {exportStatus?.dbcs.count && exportStatus.dbcs.count > 0 && (
                      <div style={{ marginTop: '4px', color: '#4caf50', fontWeight: 'bold' }}>
                        ✓ {exportStatus.dbcs.count} file{exportStatus.dbcs.count !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {exportStatus && (exportStatus.icons.count > 0 || exportStatus.dbcs.count > 0) && (
                <div style={{
                  padding: '12px',
                  backgroundColor: 'rgba(76, 175, 80, 0.1)',
                  border: '1px solid rgba(76, 175, 80, 0.3)',
                  borderRadius: '4px',
                  fontSize: '12px',
                }}>
                  <strong style={{ color: '#4caf50' }}>📂 Export Ready:</strong>
                  <div style={{ marginTop: '6px', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                    {exportStatus.icons.count > 0 && (
                      <div>Interface/Icons: {exportStatus.icons.count} file(s)</div>
                    )}
                    {exportStatus.dbcs.count > 0 && (
                      <div>DBFilesClient: {exportStatus.dbcs.count} file(s)</div>
                    )}
                  </div>
                </div>
              )}

              <hr style={{ borderColor: 'rgba(0,0,0,0.1)', margin: '20px 0' }} />

              <div style={{
                padding: '12px',
                backgroundColor: contentBoxColor,
                border: '1px solid rgba(0,0,0,0.1)',
                borderRadius: '4px',
                fontSize: '13px',
                opacity: 0.8,
              }}>
                <strong>ℹ️ Note:</strong> Base files are read-only references. Custom files are for server integration.
                Export organizes edited files in the export/ directory.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SettingsPanel;

