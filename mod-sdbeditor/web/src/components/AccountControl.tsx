import React, { useState } from 'react';

type Props = {
  token: string | null;
  baseUrl: string;
  textColor: string;
  contentBoxColor: string;
};

const AccountControl: React.FC<Props> = ({ token, baseUrl, textColor, contentBoxColor }) => {
  const [searchUsername, setSearchUsername] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expansion, setExpansion] = useState<number | ''>('');
  const [gmLevel, setGmLevel] = useState<number | ''>('');

  const searchAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchUsername.trim()) {
      setError('Please enter a username');
      return;
    }

    if (!token) return;

    try {
      setError(null);
      setSuccess(null);
      setBusy(true);

      const res = await fetch(`${baseUrl}/api/starter/account/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: searchUsername }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Account not found');
        setSelectedAccount(null);
        return;
      }

      setSelectedAccount(data);
      setExpansion(data.expansion || '');
      setGmLevel(data.gmLevel || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  };

  const updateAccount = async (action: 'set-expansion' | 'set-gmlevel' | 'ban' | 'delete') => {
    if (!token || !selectedAccount) return;

    let confirmMsg = '';
    if (action === 'ban') confirmMsg = 'Ban this account?';
    if (action === 'delete') confirmMsg = 'WARNING: This will permanently delete this account. Continue?';

    if (confirmMsg && !window.confirm(confirmMsg)) return;

    try {
      setError(null);
      setSuccess(null);
      setBusy(true);

      const body: any = { accountId: selectedAccount.id };
      if (action === 'set-expansion') body.expansion = expansion;
      if (action === 'set-gmlevel') body.gmLevel = gmLevel;

      const res = await fetch(`${baseUrl}/api/starter/account/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Action failed`);
        return;
      }

      setSuccess(`Account ${action.replace(/-/g, ' ')} successful`);
      
      if (action === 'delete') {
        setSelectedAccount(null);
        setSearchUsername('');
      } else {
        // Refresh account data
        await new Promise(resolve => setTimeout(resolve, 500));
        await searchAccount(new Event('submit') as any);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 12, color: textColor }}>
      <h3>Account Control</h3>
      <p style={{ opacity: 0.7 }}>
        Search for accounts and manage expansion levels, GM levels, bans, and deletions.
      </p>

      {/* Search Form */}
      <form onSubmit={searchAccount} style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Enter username"
            value={searchUsername}
            onChange={(e) => setSearchUsername(e.target.value)}
            style={{
              flex: 1,
              padding: 8,
              borderRadius: 4,
              border: '1px solid #ccc',
            }}
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy}
            style={{
              padding: '8px 16px',
              background: '#007bff',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {error && (
        <div style={{ padding: 12, background: '#fee', color: '#b91c1c', borderRadius: 4, marginBottom: 12 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ padding: 12, background: '#efe', color: '#16a34a', borderRadius: 4, marginBottom: 12 }}>
          {success}
        </div>
      )}

      {selectedAccount && (
        <div style={{ padding: 16, background: contentBoxColor, borderRadius: 8, color: textColor }}>
          <h4>Account: {selectedAccount.username}</h4>
          <div style={{ marginBottom: 16, fontSize: 14 }}>
            <p style={{ margin: '4px 0' }}>
              <strong>ID:</strong> {selectedAccount.id}
            </p>
            <p style={{ margin: '4px 0' }}>
              <strong>Email:</strong> {selectedAccount.email}
            </p>
            <p style={{ margin: '4px 0' }}>
              <strong>Expansion:</strong> {selectedAccount.expansion || 0} {selectedAccount.locked === 1 ? ' (LOCKED)' : ''}
            </p>
            <p style={{ margin: '4px 0' }}>
              <strong>GM Level:</strong> {selectedAccount.gmLevel || 0}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Expansion Level */}
            <div style={{ padding: 12, background: contentBoxColor, borderRadius: 4, border: '1px solid #ddd' }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold', fontSize: 12 }}>
                Expansion Level
              </label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select
                  value={expansion}
                  onChange={(e) => setExpansion(e.target.value === '' ? '' : Number(e.target.value))}
                  style={{
                    flex: 1,
                    padding: 6,
                    borderRadius: 4,
                    border: '1px solid #ccc',
                  }}
                >
                  <option value="">Select...</option>
                  <option value="0">Classic (0)</option>
                  <option value="1">TBC (1)</option>
                  <option value="2">WotLK (2)</option>
                </select>
                <button
                  onClick={() => updateAccount('set-expansion')}
                  disabled={busy || expansion === ''}
                  style={{
                    padding: '6px 12px',
                    background: '#28a745',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    cursor: busy || expansion === '' ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                    opacity: busy || expansion === '' ? 0.6 : 1,
                  }}
                >
                  Set
                </button>
              </div>
            </div>

            {/* GM Level */}
            <div style={{ padding: 12, background: contentBoxColor, borderRadius: 4, border: '1px solid #ddd' }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold', fontSize: 12 }}>
                GM Level
              </label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select
                  value={gmLevel}
                  onChange={(e) => setGmLevel(e.target.value === '' ? '' : Number(e.target.value))}
                  style={{
                    flex: 1,
                    padding: 6,
                    borderRadius: 4,
                    border: '1px solid #ccc',
                  }}
                >
                  <option value="">Select...</option>
                  <option value="0">Player (0)</option>
                  <option value="1">Moderator (1)</option>
                  <option value="2">GM (2)</option>
                  <option value="3">Admin (3)</option>
                </select>
                <button
                  onClick={() => updateAccount('set-gmlevel')}
                  disabled={busy || gmLevel === ''}
                  style={{
                    padding: '6px 12px',
                    background: '#28a745',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    cursor: busy || gmLevel === '' ? 'not-allowed' : 'pointer',
                    fontSize: 12,
                    opacity: busy || gmLevel === '' ? 0.6 : 1,
                  }}
                >
                  Set
                </button>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => updateAccount('ban')}
              disabled={busy}
              style={{
                flex: 1,
                padding: '8px 16px',
                background: selectedAccount.locked === 1 ? '#6c757d' : '#ffc107',
                color: '#000',
                border: 'none',
                borderRadius: 4,
                cursor: busy ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                opacity: busy ? 0.6 : 1,
              }}
            >
              {selectedAccount.locked === 1 ? 'Account Locked' : 'Lock Account'}
            </button>
            <button
              onClick={() => updateAccount('delete')}
              disabled={busy}
              style={{
                flex: 1,
                padding: '8px 16px',
                background: '#dc3545',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: busy ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                opacity: busy ? 0.6 : 1,
              }}
            >
              Delete Account
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountControl;
