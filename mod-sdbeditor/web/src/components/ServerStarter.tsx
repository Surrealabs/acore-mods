import React, { useEffect, useState } from 'react';

type ServiceStatus = {
  service: string;
  running: boolean;
  pids: number[];
};

type StarterStatus = {
  services: ServiceStatus[];
};

type TerminalPayload = {
  service: 'auth' | 'world';
  running: boolean;
  pids: number[];
  logPath: string;
  exists: boolean;
  interactive?: boolean;
  interactiveReason?: string;
  log: string;
  timestamp: string;
};

type FileServiceCheck = {
  key: string;
  path: string;
  exists: boolean;
};

type FileServiceStatus = {
  ok: boolean;
  pid: number;
  uptimeSeconds: number;
  config: {
    paths: {
      base: { dbc: string; icons: string; description?: string };
      custom: { dbc: string; icons: string; description?: string };
    };
    settings?: {
      activeDBCSource?: 'base' | 'custom';
      activeIconSource?: 'base' | 'custom';
    };
  };
  active: {
    dbc: string;
    icons: string;
  };
  checks: FileServiceCheck[];
  missing: string[];
  watcher?: { status: string; message?: string };
  timestamp?: string;
};

type SyncWorkflowStage = {
  name: string;
  ok: boolean;
  details?: any;
};

type SyncWorkflowReport = {
  success: boolean;
  durationMs?: number;
  stages?: SyncWorkflowStage[];
  error?: string;
  active?: { dbc: string; icons: string };
  exportPaths?: { dbcs: string; icons: string };
};

function summarizeSyncStageDetails(stage: SyncWorkflowStage): string | null {
  const d = stage.details;
  if (!d) return null;
  switch (stage.name) {
    case 'rebuild-indexes':
      return `icons=${d.spellIconEntries ?? '?'} (${d.spellIconSource || 'unknown'}), names=${d.spellNameEntries ?? '?'}`;
    case 'spell-icon-sync': {
      const parts = [`added=${d.added ?? 0}`];
      if (d.sqlUpsert?.upserted !== undefined) parts.push(`sqlSynced=${d.sqlUpsert.upserted}`);
      if (d.sqlUpsert?.error) parts.push(`sqlError=${d.sqlUpsert.error}`);
      return parts.join(', ');
    }
    case 'icon-quarantine': {
      if (d.skipped) return d.error || 'skipped';
      return `quarantined=${d.quarantinedCount ?? 0}, restored=${d.restoredCount ?? 0}, known=${d.knownIconCount ?? '?'}`;
    }
    default:
      return null;
  }
}

type DbcBackupEntry = {
  name: string;
  manual: boolean;
  mtime: string;
  mtimeMs?: number;
  fileCount: number;
};

type DbcBackupStatus = {
  success: boolean;
  lastBackup: DbcBackupEntry | null;
  count: number;
  backups?: DbcBackupEntry[];
};

type Props = {
  token: string | null;
  baseUrl: string;
  fileBaseUrl: string;
  textColor?: string;
  contentBoxColor?: string;
};

const ServerStarter: React.FC<Props> = ({ token, baseUrl, fileBaseUrl, textColor = '#000', contentBoxColor = '#f9f9f9' }) => {
  const [status, setStatus] = useState<StarterStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [terminalData, setTerminalData] = useState<Record<'auth' | 'world', TerminalPayload | null>>({ auth: null, world: null });
  const [terminalCommand, setTerminalCommand] = useState<Record<'auth' | 'world', string>>({ auth: '', world: '' });
  const [terminalBusy, setTerminalBusy] = useState<Record<'auth' | 'world', boolean>>({ auth: false, world: false });
  const [fileStatus, setFileStatus] = useState<FileServiceStatus | null>(null);
  const [fileStatusError, setFileStatusError] = useState<string | null>(null);
  const [fileStatusBusy, setFileStatusBusy] = useState(false);
  const [syncWorkflowBusy, setSyncWorkflowBusy] = useState(false);
  const [syncWorkflowError, setSyncWorkflowError] = useState<string | null>(null);
  const [syncWorkflowReport, setSyncWorkflowReport] = useState<SyncWorkflowReport | null>(null);
  const [dbcBackupStatus, setDbcBackupStatus] = useState<DbcBackupStatus | null>(null);
  const [dbcBackupBusy, setDbcBackupBusy] = useState(false);
  const [dbcBackupError, setDbcBackupError] = useState<string | null>(null);

  const parseJsonSafe = async (res: Response) => {
    const text = await res.text();
    if (!text) {
      return {} as any;
    }
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text } as any;
    }
  };

  const fetchStatus = async () => {
    if (!token) return;
    try {
      setError(null);
      const res = await fetch(`${baseUrl}/api/starter/servers/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await parseJsonSafe(res);
      if (!res.ok) {
        setError(payload.error || 'Failed to fetch status');
        return;
      }
      setStatus(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
    }
  };

  const fetchTerminal = async (service: 'auth' | 'world') => {
    if (!token) return;
    try {
      const res = await fetch(`${baseUrl}/api/starter/servers/terminal/${service}?lines=220`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await parseJsonSafe(res);
      if (!res.ok) {
        throw new Error(payload.error || `Failed to fetch ${service} terminal`);
      }
      setTerminalData((prev) => ({ ...prev, [service]: payload }));
    } catch {
      // Keep UI resilient during restarts/polls
    }
  };

  const refreshTerminals = async () => {
    await Promise.all([fetchTerminal('auth'), fetchTerminal('world')]);
  };

  const runTerminalCommand = async (service: 'auth' | 'world') => {
    if (!token) return;
    const command = terminalCommand[service]?.trim();
    if (!command) return;

    try {
      setTerminalBusy((prev) => ({ ...prev, [service]: true }));
      const res = await fetch(`${baseUrl}/api/starter/servers/terminal/${service}/exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ command }),
      });
      const payload = await parseJsonSafe(res);
      if (!res.ok) {
        setError(payload.error || `Failed to run command on ${service}`);
      }
      setTerminalCommand((prev) => ({ ...prev, [service]: '' }));
      await fetchTerminal(service);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to run command on ${service}`);
    } finally {
      setTerminalBusy((prev) => ({ ...prev, [service]: false }));
    }
  };

  const doAction = async (service: string, action: 'start' | 'stop' | 'restart') => {
    if (!token) return;
    try {
      setError(null);
      setBusy(`${service}-${action}`);
      const res = await fetch(`${baseUrl}/api/starter/servers/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ service }),
      });
      const payload = await parseJsonSafe(res);
      if (!res.ok) {
        setError(payload.error || `Failed to ${action} ${service}`);
        return;
      }
      await fetchStatus();
      if (service === 'auth' || service === 'world') {
        await fetchTerminal(service);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} ${service}`);
    } finally {
      setBusy(null);
    }
  };

  const restartStarter = async () => {
    if (!token) return;
    if (!window.confirm('This will restart the starter-server service. The page will need to be refreshed after a few seconds. Continue?')) {
      return;
    }
    try {
      setError(null);
      setBusy('starter-restart');
      await fetch(`${baseUrl}/api/starter/self-restart`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      // Service will die, so we won't get a response
    } catch (err) {
      // Expected - server is restarting
    } finally {
      setBusy(null);
    }
  };

  const restartFileService = async () => {
    if (!window.confirm('This will restart the file service (server.js). Continue?')) {
      return;
    }
    try {
      setError(null);
      setBusy('file-restart');
      await fetch(`${fileBaseUrl}/api/self-restart`, {
        method: 'POST',
      });
      // Service will die, so we won't get a response
    } catch (err) {
      // Expected - server is restarting
    } finally {
      setBusy(null);
    }
  };

  const restartWebpage = async () => {
    if (!window.confirm('This will reload the webpage. Continue?')) {
      return;
    }
    try {
      setBusy('webpage-restart');
      // Reload after a short delay to show the restarting message
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (err) {
      setError('Failed to restart webpage');
      setBusy(null);
    }
  };

  const restartNpmDevServer = async () => {
    if (!token) return;
    if (!window.confirm('This will restart the npm dev server (vite). Continue?')) {
      return;
    }
    try {
      setError(null);
      setBusy('npm-restart');
      const res = await fetch(`${baseUrl}/api/starter/npm-restart`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await parseJsonSafe(res);
      if (!res.ok) {
        setError(payload.error || 'Failed to restart npm dev server');
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart npm dev server');
    } finally {
      setBusy(null);
    }
  };

  const fetchFileStatus = async () => {
    try {
      setFileStatusBusy(true);
      setFileStatusError(null);
      const res = await fetch(`${fileBaseUrl}/api/file-service-status`);
      const payload = await parseJsonSafe(res);
      if (!res.ok) {
        setFileStatusError(payload.error || 'Failed to fetch file service status');
        return;
      }
      setFileStatus(payload);
    } catch (err) {
      setFileStatusError(err instanceof Error ? err.message : 'Failed to fetch file service status');
    } finally {
      setFileStatusBusy(false);
    }
  };

  const runSyncWorkflow = async () => {
    try {
      setSyncWorkflowBusy(true);
      setSyncWorkflowError(null);
      const res = await fetch(`${fileBaseUrl}/api/sync-workflow/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoRepairLocaleOffsets: true,
          runSpellIconSync: true,
          runIconQuarantine: true,
        }),
      });
      const payload = await parseJsonSafe(res);
      setSyncWorkflowReport(payload as SyncWorkflowReport);
      if (!res.ok) {
        setSyncWorkflowError(payload.error || 'Sync workflow failed');
      }
      await fetchFileStatus();
    } catch (err) {
      setSyncWorkflowError(err instanceof Error ? err.message : 'Sync workflow failed');
    } finally {
      setSyncWorkflowBusy(false);
    }
  };

  const fetchDbcBackupStatus = async () => {
    try {
      const res = await fetch(`${fileBaseUrl}/api/dbc-backup/status`);
      const payload = await parseJsonSafe(res);
      if (!res.ok) {
        setDbcBackupError(payload.error || 'Failed to fetch DBC backup status');
        return;
      }
      setDbcBackupStatus(payload as DbcBackupStatus);
    } catch (err) {
      setDbcBackupError(err instanceof Error ? err.message : 'Failed to fetch DBC backup status');
    }
  };

  const runDbcBackupNow = async () => {
    try {
      setDbcBackupBusy(true);
      setDbcBackupError(null);
      const res = await fetch(`${fileBaseUrl}/api/dbc-backup/run`, { method: 'POST' });
      const payload = await parseJsonSafe(res);
      if (!res.ok) {
        setDbcBackupError(payload.error || 'DBC backup failed');
        return;
      }
      await fetchDbcBackupStatus();
    } catch (err) {
      setDbcBackupError(err instanceof Error ? err.message : 'DBC backup failed');
    } finally {
      setDbcBackupBusy(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    refreshTerminals();
    fetchFileStatus();
    fetchDbcBackupStatus();
  }, [token, fileBaseUrl]);

  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => {
      fetchStatus();
      refreshTerminals();
    }, 3000);
    return () => clearInterval(timer);
  }, [token, baseUrl]);

  const serviceStatus = (service: 'auth' | 'world') => {
    return status?.services?.find((svc) => svc.service === service) || {
      service,
      running: terminalData[service]?.running || false,
      pids: terminalData[service]?.pids || [],
    };
  };

  const renderTerminalCard = (service: 'auth' | 'world', title: string) => {
    const svc = serviceStatus(service);
    const terminal = terminalData[service];

    return (
      <div
        key={service}
        style={{
          border: '1px solid #dbe4f0',
          borderRadius: 10,
          background: contentBoxColor,
          padding: 14,
          display: 'grid',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h4 style={{ margin: 0, color: textColor }}>{title}</h4>
          <span style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 999,
            background: svc.running ? '#dcfce7' : '#fee2e2',
            color: svc.running ? '#166534' : '#991b1b',
            fontWeight: 700,
          }}>
            {svc.running ? 'RUNNING' : 'STOPPED'}
          </span>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
            {svc.pids.length > 0 ? `PID: ${svc.pids.join(', ')}` : 'No active PID'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => doAction(service, 'start')} disabled={busy !== null}>Start</button>
          <button onClick={() => doAction(service, 'stop')} disabled={busy !== null}>Stop</button>
          <button onClick={() => doAction(service, 'restart')} disabled={busy !== null}>Restart</button>
          <button onClick={() => fetchTerminal(service)} disabled={busy !== null}>Refresh Terminal</button>
          <button onClick={() => setTerminalCommand((prev) => ({ ...prev, [service]: 'status' }))} disabled={terminalBusy[service]}>Status Cmd</button>
          <button onClick={() => setTerminalCommand((prev) => ({ ...prev, [service]: 'tail 60' }))} disabled={terminalBusy[service]}>Tail Cmd</button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={terminalCommand[service]}
            onChange={(e) => setTerminalCommand((prev) => ({ ...prev, [service]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                runTerminalCommand(service);
              }
            }}
            placeholder="Commands: status, start, stop, restart, tail 60, clear, help"
            style={{
              flex: 1,
              minWidth: 180,
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              padding: '6px 8px',
              background: '#fff',
              color: '#0f172a',
              fontSize: 12,
            }}
          />
          <button onClick={() => runTerminalCommand(service)} disabled={terminalBusy[service] || !terminalCommand[service]?.trim()}>
            {terminalBusy[service] ? 'Running...' : 'Run'}
          </button>
        </div>

        <div style={{ fontSize: 12, color: '#64748b' }}>
          {terminal?.logPath ? `Source: ${terminal.logPath}` : 'Source: waiting for log path...'}
        </div>

        <div style={{ fontSize: 12, color: terminal?.interactive ? '#166534' : '#b45309' }}>
          {terminal?.interactive
            ? 'Interactive input attached — commands are sent to server console.'
            : (terminal?.interactiveReason || 'Interactive input not attached yet.')}
        </div>

        <pre
          style={{
            margin: 0,
            height: 320,
            overflow: 'auto',
            background: '#0b1220',
            color: '#cbd5e1',
            borderRadius: 8,
            border: '1px solid #1e293b',
            padding: 12,
            fontSize: 12,
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {terminal?.log || 'No terminal output yet. Start/restart the service or refresh terminal.'}
        </pre>
      </div>
    );
  };

  return (
    <div style={{ padding: 12, color: textColor }}>
      <h3 style={{ marginBottom: 4 }}>Server Restarter</h3>
      <p style={{ opacity: 0.75, marginTop: 0 }}>
        Integrated control panel with dedicated in-page terminals for authserver and worldserver.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={fetchStatus} disabled={!token || busy !== null}>Refresh Status</button>
        <button onClick={refreshTerminals} disabled={!token || busy !== null}>Refresh Both Terminals</button>
      </div>
      {error && <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div>}
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        {renderTerminalCard('auth', 'Auth Server Terminal')}
        {renderTerminalCard('world', 'World Server Terminal')}
      </div>

      <div style={{ marginTop: 20, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <div style={{ padding: 14, borderRadius: 8, background: contentBoxColor, border: '1px solid #e2e8f0' }}>
          <h4 style={{ margin: 0, marginBottom: 8, color: textColor }}>Starter Service</h4>
          <button onClick={restartStarter} disabled={busy !== null}>
            {busy === 'starter-restart' ? 'Restarting...' : 'Restart Starter Service'}
          </button>
        </div>

        <div style={{ padding: 14, borderRadius: 8, background: contentBoxColor, border: '1px solid #e2e8f0' }}>
          <h4 style={{ margin: 0, marginBottom: 8, color: textColor }}>File Service</h4>
          <button onClick={restartFileService} disabled={busy !== null}>
            {busy === 'file-restart' ? 'Restarting...' : 'Restart File Service'}
          </button>
        </div>

        <div style={{ padding: 14, borderRadius: 8, background: contentBoxColor, border: '1px solid #e2e8f0' }}>
          <h4 style={{ margin: 0, marginBottom: 8, color: textColor }}>Web UI</h4>
          <button onClick={restartWebpage} disabled={busy !== null}>
            {busy === 'webpage-restart' ? 'Restarting...' : 'Reload Webpage'}
          </button>
        </div>

        <div style={{ padding: 14, borderRadius: 8, background: contentBoxColor, border: '1px solid #e2e8f0' }}>
          <h4 style={{ margin: 0, marginBottom: 8, color: textColor }}>NPM Dev Server</h4>
          <button onClick={restartNpmDevServer} disabled={busy !== null}>
            {busy === 'npm-restart' ? 'Restarting...' : 'Restart NPM Dev Server'}
          </button>
        </div>

        <div style={{ padding: 14, borderRadius: 8, background: contentBoxColor, border: '1px solid #e2e8f0' }}>
          <h4 style={{ margin: 0, marginBottom: 8, color: textColor }}>DBC Sync + Validation</h4>
          <button onClick={runSyncWorkflow} disabled={syncWorkflowBusy || busy !== null}>
            {syncWorkflowBusy ? 'Running...' : 'Run Sync Workflow'}
          </button>
          <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
            Imports server DBCs, runs Spell.dbc locale preflight/repair, syncs SpellIcon export (new icons get a
            sdbeditor.spellicon row automatically), quarantines any icon file with no matching
            sdbeditor.spellicon entry into an "_unlisted" subfolder, then rebuilds the spell-icon index from SQL.
          </div>
        </div>

        <div style={{ padding: 14, borderRadius: 8, background: contentBoxColor, border: '1px solid #e2e8f0' }}>
          <h4 style={{ margin: 0, marginBottom: 8, color: textColor }}>DBC Backup</h4>
          <button onClick={runDbcBackupNow} disabled={dbcBackupBusy || busy !== null}>
            {dbcBackupBusy ? 'Backing up...' : 'Backup Now'}
          </button>
          <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
            {dbcBackupStatus?.lastBackup ? (
              <>
                Last backup: {new Date(dbcBackupStatus.lastBackup.mtime).toLocaleString()}
                {' '}({dbcBackupStatus.lastBackup.fileCount} files{dbcBackupStatus.lastBackup.manual ? ', manual' : ', automatic'})
                <br />
                Total snapshots: {dbcBackupStatus.count}
              </>
            ) : (
              'No backups yet.'
            )}
            {dbcBackupError && (
              <div style={{ marginTop: 4, color: '#dc2626' }}>{dbcBackupError}</div>
            )}
          </div>
        </div>
      </div>

      {(syncWorkflowError || syncWorkflowReport) && (
        <div
          style={{
            marginTop: 16,
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: 12,
            backgroundColor: contentBoxColor,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ color: textColor }}>Sync Workflow Report</strong>
            {syncWorkflowReport && (
              <span style={{ fontSize: 12, color: syncWorkflowReport.success ? '#166534' : '#991b1b' }}>
                {syncWorkflowReport.success ? 'PASS' : 'FAIL'}
              </span>
            )}
            {syncWorkflowReport?.durationMs !== undefined && (
              <span style={{ fontSize: 12, color: '#64748b' }}>{syncWorkflowReport.durationMs}ms</span>
            )}
          </div>

          {syncWorkflowError && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>{syncWorkflowError}</div>
          )}

          {syncWorkflowReport?.stages?.length ? (
            <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
              {syncWorkflowReport.stages.map((stage, idx) => (
                <div key={`${stage.name}-${idx}`} style={{ fontSize: 12 }}>
                  <span style={{ color: stage.ok ? '#166534' : '#991b1b' }}>
                    {stage.ok ? 'OK' : 'FAIL'} - {stage.name}
                  </span>
                  {summarizeSyncStageDetails(stage) && (
                    <span style={{ color: '#64748b', marginLeft: 6 }}>{summarizeSyncStageDetails(stage)}</span>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {syncWorkflowReport?.active && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
              Active paths: DBC={syncWorkflowReport.active.dbc}, Icons={syncWorkflowReport.active.icons}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <h4 style={{ margin: '0 0 8px 0' }}>File Service Status</h4>
        <p style={{ opacity: 0.7, marginTop: 0 }}>
          Shows the backend file service health and whether the configured paths exist.
        </p>
        <button onClick={fetchFileStatus} disabled={fileStatusBusy}>
          {fileStatusBusy ? 'Refreshing...' : 'Refresh File Service'}
        </button>
        {fileStatusError && (
          <div style={{ marginTop: 12, color: '#b91c1c' }}>{fileStatusError}</div>
        )}
        <div
          style={{
            marginTop: 12,
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: 12,
            backgroundColor: contentBoxColor,
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ fontWeight: 600 }}>File Service</div>
            <div style={{ color: fileStatus ? '#16a34a' : '#b91c1c' }}>
              {fileStatus ? 'Online' : 'Offline'}
            </div>
            {fileStatus?.pid && (
              <div style={{ color: '#64748b', fontSize: 12 }}>
                PID: {fileStatus.pid} • Uptime: {fileStatus.uptimeSeconds}s
              </div>
            )}
          </div>

          {fileStatus && (
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 13, color: '#334155' }}>
                Active paths: DBC={fileStatus.active.dbc}, Icons={fileStatus.active.icons}
              </div>
              {fileStatus.missing?.length > 0 && (
                <div style={{ fontSize: 13, color: '#b91c1c' }}>
                  Missing folders: {fileStatus.missing.join(', ')}
                </div>
              )}
              <div style={{ display: 'grid', gap: 6 }}>
                {fileStatus.checks.map((entry) => (
                  <div key={entry.key} style={{ fontSize: 12, color: entry.exists ? '#16a34a' : '#b91c1c' }}>
                    {entry.key}: {entry.exists ? 'OK' : 'Missing'} — {entry.path}
                  </div>
                ))}
              </div>
              {fileStatus.watcher && (
                <div style={{ fontSize: 12, color: '#475569' }}>
                  Watcher: {fileStatus.watcher.status}{fileStatus.watcher.message ? ` — ${fileStatus.watcher.message}` : ''}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ServerStarter;
