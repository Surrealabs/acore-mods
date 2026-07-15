
import React, { useEffect, useMemo, useState } from 'react';
import './App.css';

import TalentBuilder from './components/TalentBuilder';
import TalentEditor from './components/TalentEditor';
import SpellIconEditor from './components/SpellIconEditor';
import SpellEditor from './components/SpellEditor';
import ServerStarter from './components/ServerStarter';
import AccountControl from './components/AccountControl';
import DBCEditor from './components/DBCEditor';
import CharStartOutfitEditor from './components/CharStartOutfitEditor';
// TalentLayoutEditor removed — unified into TalentEditor

function FolderInitializer({ fileBase, contentBoxColor }: { fileBase: string; contentBoxColor: string }) {
  const [status, setStatus] = useState<{ dir: string; exists: boolean }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: string[]; existed: string[] } | null>(null);

  const checkStatus = async () => {
    try {
      const res = await fetch(`${fileBase}/api/initialize-folders/status`);
      const data = await res.json();
      setStatus(data.status);
    } catch { /* ignore */ }
  };

  useEffect(() => { checkStatus(); }, []);

  const initFolders = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${fileBase}/api/initialize-folders`, { method: 'POST' });
      const data = await res.json();
      setResult(data);
      checkStatus();
    } catch (err: unknown) {
      setResult({ created: [], existed: [`Error: ${err instanceof Error ? err.message : String(err)}`] });
    } finally {
      setBusy(false);
    }
  };

  const allReady = status?.every(s => s.exists);

  return (
    <div>
      {status && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginBottom: 12, fontSize: 13 }}>
          {status.map(s => (
            <div key={s.dir} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: s.exists ? '#4caf50' : '#f44336' }}>{s.exists ? '✓' : '✗'}</span>
              <span style={{ fontFamily: 'monospace' }}>{s.dir}/</span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={initFolders}
        disabled={busy}
        style={{
          padding: '8px 16px',
          borderRadius: 4,
          border: 'none',
          background: allReady ? '#4caf50' : '#ff9800',
          color: '#fff',
          cursor: busy ? 'not-allowed' : 'pointer',
          fontWeight: 'bold',
          fontSize: 13,
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Initializing...' : allReady ? '✓ All Folders Ready' : 'Initialize Folders'}
      </button>

      {result && result.created.length > 0 && (
        <p style={{ fontSize: 12, color: '#4caf50', marginTop: 8 }}>
          Created: {result.created.join(', ')}
        </p>
      )}
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<'armory' | 'talentbuilder' | 'talenteditor' | 'spellicon' | 'loadingscreen' | 'itemeditor' | 'spelleditor' | 'serverstarter' | 'accountcontrol' | 'settings' | 'dbceditor' | 'startingequip' | 'account' | 'shop'>('talentbuilder');
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('starterToken'));
  const [gmLevel, setGmLevel] = useState<number>(() => Number(localStorage.getItem('starterGmLevel') || 0));
  const [loginError, setLoginError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [headerImage, setHeaderImage] = useState<string | null>(null);
  const [headerUploadBusy, setHeaderUploadBusy] = useState(false);
  const [loginTitle, setLoginTitle] = useState<string>('SDBEditor Login');
  const [editingLoginTitle, setEditingLoginTitle] = useState<string>('');
  const [pageTitle, setPageTitle] = useState<string>(() => localStorage.getItem('pageTitle') || 'SDBEditor');
  const [editingPageTitle, setEditingPageTitle] = useState<string>('');
  const [backgroundColor, setBackgroundColor] = useState<string>(() => localStorage.getItem('backgroundColor') || '#ffffff');
  const [editingBackgroundColor, setEditingBackgroundColor] = useState<string>(() => localStorage.getItem('backgroundColor') || '#ffffff');
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [backgroundUploadBusy, setBackgroundUploadBusy] = useState(false);
  const [pageIcon, setPageIcon] = useState<string | null>(null);
  const [pageIconUploadBusy, setPageIconUploadBusy] = useState(false);
  const [pageIconError, setPageIconError] = useState<string | null>(null);
  const [textColor, setTextColor] = useState<string>(() => localStorage.getItem('textColor') || '#000000');
  const [editingTextColor, setEditingTextColor] = useState<string>(() => localStorage.getItem('textColor') || '#000000');
  const [contentBoxColor, setContentBoxColor] = useState<string>(() => localStorage.getItem('contentBoxColor') || '#f9f9f9');
  const [editingContentBoxColor, setEditingContentBoxColor] = useState<string>(() => localStorage.getItem('contentBoxColor') || '#f9f9f9');
  const [appErrors, setAppErrors] = useState<Array<{ id: number; message: string; time: string }>>([]);
  const [showErrorPanel, setShowErrorPanel] = useState(false);

  const addAppError = (message: string) => {
    setAppErrors((prev) => {
      const next = [{ id: Date.now(), message, time: new Date().toLocaleTimeString() }, ...prev];
      return next.slice(0, 50);
    });
  };

  // Update document title when pageTitle changes
  useEffect(() => {
    document.title = pageTitle;
    localStorage.setItem('pageTitle', pageTitle);
  }, [pageTitle]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      addAppError(`Uncaught: ${event.message} (${event.filename}:${event.lineno})`);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = typeof event.reason === 'string' ? event.reason : JSON.stringify(event.reason);
      addAppError(`Unhandled rejection: ${reason}`);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // Save color settings to localStorage
  useEffect(() => {
    localStorage.setItem('backgroundColor', backgroundColor);
  }, [backgroundColor]);

  useEffect(() => {
    localStorage.setItem('textColor', textColor);
  }, [textColor]);

  useEffect(() => {
    localStorage.setItem('contentBoxColor', contentBoxColor);
  }, [contentBoxColor]);

  // Update favicon when pageIcon changes
  useEffect(() => {
    if (pageIcon) {
      let favicon = document.querySelector("link[rel='icon']") as HTMLLinkElement;
      if (!favicon) {
        favicon = document.createElement('link');
        favicon.rel = 'icon';
        document.head.appendChild(favicon);
      }
      favicon.href = pageIcon;
      favicon.type = 'image/png';
    }
  }, [pageIcon]);

  const starterBase = useMemo(() => {
    return ``;  // Empty - paths already include /api/starter via proxy
  }, []);

  const fileBase = useMemo(() => {
    return ``;  // Empty - paths already include /api via proxy  
  }, []);

  useEffect(() => {
    fetch(`${starterBase}/api/starter/health`)
      .then((res) => res.json())
      .then((data) => setNeedsSetup(Boolean(data.needsSetup)))
      .catch(() => setNeedsSetup(false));
    
    // Load custom login title
    fetch(`${starterBase}/api/starter/settings/login-title`)
      .then((res) => res.json())
      .then((data) => {
        if (data.loginTitle) {
          setLoginTitle(data.loginTitle);
          setEditingLoginTitle(data.loginTitle);
        }
      })
      .catch(() => {
        // Use default
      });
  }, [starterBase]);

  useEffect(() => {
    // Load header image from file service
    fetch(`${fileBase}/header-image.png`)
      .then((res) => {
        if (res.ok) {
          setHeaderImage(`${fileBase}/header-image.png?t=${Date.now()}`);
        }
      })
      .catch(() => {
        // Header image doesn't exist yet
      });
    
    // Load background image
    fetch(`${fileBase}/background-image.png`)
      .then((res) => {
        if (res.ok) {
          setBackgroundImage(`${fileBase}/background-image.png?t=${Date.now()}`);
        }
      })
      .catch(() => {
        // Background image doesn't exist yet
      });
    
    // Load page icon (try .ico first, then .png)
    fetch(`${fileBase}/page-icon.ico`)
      .then((res) => {
        if (res.ok) {
          setPageIcon(`${fileBase}/page-icon.ico?t=${Date.now()}`);
        } else {
          // Try PNG format
          return fetch(`${fileBase}/page-icon.png`);
        }
      })
      .then((res) => {
        if (res && res.ok) {
          setPageIcon(`${fileBase}/page-icon.png?t=${Date.now()}`);
        }
      })
      .catch(() => {
        // Page icon doesn't exist yet
      });
    
    // Load background color
    fetch(`${starterBase}/api/starter/settings/background`)
      .then((res) => res.json())
      .then((data) => {
        if (data.backgroundColor) {
          setBackgroundColor(data.backgroundColor);
          setEditingBackgroundColor(data.backgroundColor);
          localStorage.setItem('backgroundColor', data.backgroundColor);
        }
        if (data.textColor) {
          setTextColor(data.textColor);
          setEditingTextColor(data.textColor);
          localStorage.setItem('textColor', data.textColor);
        }
        if (data.contentBoxColor) {
          setContentBoxColor(data.contentBoxColor);
          setEditingContentBoxColor(data.contentBoxColor);
          localStorage.setItem('contentBoxColor', data.contentBoxColor);
        }
        if (data.pageTitle) {
          setPageTitle(data.pageTitle);
          setEditingPageTitle(data.pageTitle);
          localStorage.setItem('pageTitle', data.pageTitle);
        }
      })
      .catch(() => {
        // Use default
      });
  }, [fileBase, starterBase]);

  useEffect(() => {
    if (gmLevel <= 0 && (tab === 'serverstarter' || tab === 'spellicon' || tab === 'talenteditor' || tab === 'settings' || tab === 'dbceditor' || tab === 'startingequip' || tab === 'loadingscreen' || tab === 'itemeditor' || tab === 'spelleditor' || tab === 'accountcontrol')) {
      setTab('talentbuilder');
    }
  }, [gmLevel, tab]);

  // Sync editing fields when settings tab is opened
  useEffect(() => {
    if (tab === 'settings') {
      setEditingPageTitle(pageTitle);
      setEditingBackgroundColor(backgroundColor);
      setEditingTextColor(textColor);
      setEditingContentBoxColor(contentBoxColor);
    }
  }, [tab, pageTitle, backgroundColor, textColor, contentBoxColor]);

  const onLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);
    setBusy(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const username = String(formData.get('username') || '');
    const password = String(formData.get('password') || '');

    try {
      const response = await fetch(`${starterBase}/api/starter/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setLoginError(payload.error || 'Login failed');
        return;
      }

      localStorage.setItem('starterToken', payload.token);
      localStorage.setItem('starterGmLevel', String(payload.gmLevel ?? 0));
      setToken(payload.token);
      setGmLevel(payload.gmLevel ?? 0);
      form.reset();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const onLogout = () => {
    localStorage.removeItem('starterToken');
    localStorage.removeItem('starterGmLevel');
    setToken(null);
    setGmLevel(0);
  };

  const onSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSignupError(null);
    setSignupSuccess(false);
    setBusy(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const username = String(formData.get('username') || '');
    const password = String(formData.get('password') || '');
    const email = String(formData.get('email') || '');

    try {
      const response = await fetch(`${starterBase}/api/starter/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setSignupError(payload.error || 'Signup failed');
        return;
      }

      setSignupSuccess(true);
      form.reset();
      setTimeout(() => {
        setShowSignup(false);
        setSignupSuccess(false);
      }, 2000);
    } catch (error) {
      setSignupError(error instanceof Error ? error.message : 'Signup failed');
    } finally {
      setBusy(false);
    }
  };

  const onHeaderImageUpload = async (file: File) => {
    if (gmLevel <= 0) return;

    try {
      setHeaderUploadBusy(true);
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${fileBase}/api/upload-header-image`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        // Reload header image with cache busting
        setHeaderImage(`${fileBase}/header-image.png?t=${Date.now()}`);
      }
    } catch (err) {
      console.error('Header upload error:', err);
    } finally {
      setHeaderUploadBusy(false);
    }
  };

  const onSaveLoginTitle = async () => {
    try {
      const response = await fetch(`${starterBase}/api/starter/settings/login-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginTitle: editingLoginTitle }),
      });
      if (response.ok) {
        setLoginTitle(editingLoginTitle);
      }
    } catch (err) {
      console.error('Failed to save login title:', err);
    }
  };

  const onSavePageTitle = async () => {
    try {
      const response = await fetch(`${starterBase}/api/starter/settings/page-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageTitle: editingPageTitle }),
      });
      if (response.ok) {
        setPageTitle(editingPageTitle);
      }
    } catch (err) {
      console.error('Failed to save page title:', err);
    }
  };

  const onSaveBackgroundColor = async () => {
    try {
      const response = await fetch(`${starterBase}/api/starter/settings/background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backgroundColor: editingBackgroundColor, textColor, contentBoxColor }),
      });
      if (response.ok) {
        setBackgroundColor(editingBackgroundColor);
      }
    } catch (err) {
      console.error('Failed to save background color:', err);
    }
  };

  const onSaveTextColor = async () => {
    try {
      const response = await fetch(`${starterBase}/api/starter/settings/background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backgroundColor, textColor: editingTextColor, contentBoxColor }),
      });
      if (response.ok) {
        setTextColor(editingTextColor);
      }
    } catch (err) {
      console.error('Failed to save text color:', err);
    }
  };

  const onSaveContentBoxColor = async () => {
    try {
      const response = await fetch(`${starterBase}/api/starter/settings/background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backgroundColor, textColor, contentBoxColor: editingContentBoxColor }),
      });
      if (response.ok) {
        setContentBoxColor(editingContentBoxColor);
      }
    } catch (err) {
      console.error('Failed to save content box color:', err);
    }
  };

  const onBackgroundImageUpload = async (file: File) => {
    if (gmLevel <= 0) return;

    try {
      setBackgroundUploadBusy(true);
      const formData = new FormData();
      formData.append('file', file);

      console.log('Uploading background:', file.name, file.type, file.size);

      const response = await fetch(`${fileBase}/api/upload-background-image`, {
        method: 'POST',
        body: formData,
      });

      console.log('Background upload response:', response.status, response.statusText);

      if (!response.ok) {
        const data = await response.json();
        console.error('Upload error:', data);
        return;
      }

      if (response.ok) {
        setBackgroundImage(`${fileBase}/background-image.png?t=${Date.now()}`);
      }
    } catch (err) {
      console.error('Background upload error:', err);
    } finally {
      setBackgroundUploadBusy(false);
    }
  };

  const onClearBackground = async () => {
    try {
      const response = await fetch(`${fileBase}/api/clear-background-image`, {
        method: 'POST',
      });
      if (response.ok) {
        setBackgroundImage(null);
      }
    } catch (err) {
      console.error('Failed to clear background:', err);
    }
  };

  const onPageIconUpload = async (file: File) => {
    if (gmLevel <= 0) return;

    try {
      setPageIconUploadBusy(true);
      setPageIconError(null);
      const formData = new FormData();
      formData.append('file', file);

      console.log('Uploading file:', file.name, file.type, file.size);

      const response = await fetch(`${fileBase}/api/upload-page-icon`, {
        method: 'POST',
        body: formData,
      });

      console.log('Upload response status:', response.status, response.statusText);
      console.log('Response content-type:', response.headers.get('content-type'));

      let data;
      try {
        data = await response.json();
      } catch (parseErr) {
        const text = await response.text();
        console.error('Failed to parse response as JSON. Response text:', text.substring(0, 100));
        setPageIconError('Server returned invalid response. Check browser console and server logs.');
        return;
      }

      if (response.ok && data.filename) {
        // Use the actual filename returned by the server
        setPageIcon(`${fileBase}/${data.filename}?t=${Date.now()}`);
      } else {
        setPageIconError(data.error || 'Upload failed');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Upload failed';
      setPageIconError(errorMsg);
      console.error('Page icon upload error:', err);
    } finally {
      setPageIconUploadBusy(false);
    }
  };

  const onClearPageIcon = async () => {
    try {
      setPageIconError(null);
      const response = await fetch(`${fileBase}/api/clear-page-icon`, {
        method: 'POST',
      });
      if (response.ok) {
        setPageIcon(null);
      } else {
        const data = await response.json();
        setPageIconError(data.error || 'Clear failed');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Clear failed';
      setPageIconError(errorMsg);
      console.error('Failed to clear page icon:', err);
    }
  };

  const errorPanel = (
    <>
      <button
        type="button"
        onClick={() => setShowErrorPanel((prev) => !prev)}
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: 9999,
          padding: '8px 12px',
          background: showErrorPanel ? '#111827' : '#1f2937',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}
      >
        Errors ({appErrors.length})
      </button>
      {showErrorPanel && (
        <div
          style={{
            position: 'fixed',
            right: 16,
            bottom: 56,
            width: 420,
            maxWidth: '90vw',
            maxHeight: '60vh',
            overflow: 'auto',
            zIndex: 9999,
            background: '#0b0f19',
            color: '#e5e7eb',
            border: '1px solid #1f2937',
            borderRadius: 8,
            padding: 12,
            boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Runtime Errors</strong>
            <button
              type="button"
              onClick={() => setAppErrors([])}
              style={{
                background: '#111827',
                color: '#9ca3af',
                border: '1px solid #374151',
                borderRadius: 4,
                padding: '2px 6px',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              Clear
            </button>
          </div>
          <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
            {appErrors.length === 0 ? (
              <div style={{ color: '#9ca3af' }}>No errors captured.</div>
            ) : (
              appErrors.map((err) => (
                <div key={err.id} style={{ borderTop: '1px solid #1f2937', paddingTop: 6 }}>
                  <div style={{ color: '#fca5a5', fontWeight: 600 }}>{err.time}</div>
                  <div style={{ color: '#e5e7eb', wordBreak: 'break-word' }}>{err.message}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );

  if (!token) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: backgroundImage
            ? `url(${backgroundImage}) center/cover no-repeat`
            : backgroundColor,
          color: textColor,
        }}
      >
        {showSignup ? (
          <div style={{ width: 300, paddingLeft: 24, paddingTop: 0 }}>
            <h2 style={{ marginTop: 0, marginBottom: 12 }}>Create Account</h2>
            <form onSubmit={onSignup}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input name="username" placeholder="Username" required style={{ padding: 6 }} />
                <input name="password" type="password" placeholder="Password" required style={{ padding: 6 }} />
                <input name="email" type="email" placeholder="Email" required style={{ padding: 6 }} />
                <button type="submit" disabled={busy} style={{ padding: 6 }}>
                  {busy ? 'Creating...' : 'Create Account'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowSignup(false);
                    setSignupError(null);
                    setSignupSuccess(false);
                  }}
                  style={{ padding: 6, background: '#6b7280', color: '#fff', border: 'none', cursor: 'pointer' }}
                >
                  Back to Login
                </button>
              </div>
            </form>
            {signupError && <div style={{ marginTop: 12, color: '#b91c1c', fontSize: 12 }}>{signupError}</div>}
            {signupSuccess && <div style={{ marginTop: 12, color: '#16a34a', fontSize: 12 }}>Account created! Redirecting to login...</div>}
          </div>
        ) : (
          <div style={{ width: 150, paddingLeft: 24, paddingTop: 0 }}>
            <h2 style={{ marginTop: 0, marginBottom: 12 }}>{loginTitle}</h2>
            {needsSetup && (
              <div style={{ marginBottom: 12, padding: 10, background: '#f1f5f9', borderRadius: 6 }}>
                Starter service not configured. Open {starterBase} to run setup.
              </div>
            )}
            <form onSubmit={onLogin}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input name="username" placeholder="Game account" required style={{ padding: 6 }} />
                <input name="password" type="password" placeholder="Password" required style={{ padding: 6 }} />
                <button type="submit" disabled={busy} style={{ padding: 6 }}>{busy ? 'Signing in...' : 'Sign in'}</button>
                <button
                  type="button"
                  onClick={() => setShowSignup(true)}
                  style={{ padding: 6, background: '#16a34a', color: '#fff', border: 'none', cursor: 'pointer' }}
                >
                  Sign Up
                </button>
              </div>
            </form>
            {loginError && <div style={{ marginTop: 12, color: '#b91c1c', fontSize: 12 }}>{loginError}</div>}
          </div>
        )}
        {errorPanel}
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: backgroundImage
          ? `url(${backgroundImage}) center/cover no-repeat`
          : backgroundColor,
        color: textColor,
      }}
    >
      {errorPanel}
      {/* Header Section */}
      <div
        style={{
          width: '100%',
          minHeight: 120,
          background: '#f5f5f5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          borderBottom: '1px solid #ddd',
          overflow: 'hidden',
        }}
      >
        {headerImage ? (
          <img
            src={headerImage}
            alt="Server Header"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ color: '#aaa', fontSize: 14 }}>Server Header (admins can upload an image)</div>
        )}

        {gmLevel > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 10,
            }}
          >
            <label
              htmlFor="header-file-input"
              style={{
                padding: '6px 12px',
                background: '#007bff',
                color: '#fff',
                borderRadius: 4,
                cursor: headerUploadBusy ? 'not-allowed' : 'pointer',
                fontSize: 12,
                fontWeight: 'bold',
                opacity: headerUploadBusy ? 0.6 : 1,
              }}
            >
              {headerUploadBusy ? 'Uploading...' : 'Upload Image'}
            </label>
            <input
              id="header-file-input"
              type="file"
              accept="image/*"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  onHeaderImageUpload(e.target.files[0]);
                }
                e.target.value = ''; // Reset input
              }}
              style={{ display: 'none' }}
              disabled={headerUploadBusy}
            />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #ccc', marginBottom: 0, paddingLeft: 24 }}>
        {/* Main Editor Tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0 }}>
          {[
            { id: 'talentbuilder' as const, label: 'Spec Builder', gm: false },
            { id: 'armory' as const, label: 'Armory', gm: false },
            { id: 'account' as const, label: 'Account', gm: false },
            { id: 'shop' as const, label: 'Shop', gm: false },
            { id: 'itemeditor' as const, label: 'Item Editor', gm: true },
            { id: 'spelleditor' as const, label: 'Spell Editor', gm: true },
            { id: 'talenteditor' as const, label: 'Talent Editor', gm: true },
          ].filter(t => !t.gm || gmLevel > 0).map(t => (
            <button
              key={t.id}
              style={{
                padding: '8px 14px',
                border: 'none',
                borderBottom: tab === t.id ? '2px solid #007bff' : '2px solid transparent',
                background: 'none',
                cursor: 'pointer',
                fontWeight: tab === t.id ? 'bold' : 'normal',
                color: textColor,
                fontSize: '13px',
              }}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}

          {/* Admin tools dropdown */}
          {gmLevel > 0 && (
            <div style={{ position: 'relative', marginLeft: 8 }}>
              <details style={{ display: 'inline' }}>
                <summary
                  style={{
                    padding: '8px 14px',
                    cursor: 'pointer',
                    color: ['dbceditor','startingequip','serverstarter','accountcontrol','settings','spellicon','loadingscreen'].includes(tab) ? '#007bff' : textColor,
                    fontWeight: ['dbceditor','startingequip','serverstarter','accountcontrol','settings','spellicon','loadingscreen'].includes(tab) ? 'bold' : 'normal',
                    fontSize: '13px',
                    listStyle: 'none',
                    userSelect: 'none',
                    borderBottom: ['dbceditor','startingequip','serverstarter','accountcontrol','settings','spellicon','loadingscreen'].includes(tab) ? '2px solid #007bff' : '2px solid transparent',
                  }}
                >
                  Tools ▾
                </summary>
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  background: contentBoxColor || '#fff',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  zIndex: 100,
                  minWidth: 180,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                }}>
                  {[
                    { id: 'dbceditor' as const, label: 'DBC Editor' },
                    { id: 'startingequip' as const, label: 'Starting Equipment' },
                    { id: 'spellicon' as const, label: 'Icon Editor' },
                    { id: 'loadingscreen' as const, label: 'Loading Screens' },
                    { id: 'serverstarter' as const, label: 'Server Starter' },
                    { id: 'accountcontrol' as const, label: 'Account Control' },
                    { id: 'settings' as const, label: 'Settings' },
                  ].map(t => (
                    <button
                      key={t.id}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '8px 16px',
                        border: 'none',
                        background: tab === t.id ? '#007bff' : 'transparent',
                        color: tab === t.id ? '#fff' : textColor,
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: '13px',
                      }}
                      onClick={(e) => {
                        setTab(t.id);
                        (e.currentTarget.closest('details') as HTMLDetailsElement)?.removeAttribute('open');
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </details>
            </div>
          )}

          <button
            style={{
              marginLeft: 'auto',
              padding: '8px 14px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: '#c00',
              fontSize: '13px',
            }}
            onClick={onLogout}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div style={{ padding: '16px 24px' }}>
        {tab === 'armory' && (
          gmLevel > 0 ? (
            <div style={{ padding: 12, color: '#999' }}>
              Armory coming soon. Enabled for admins.
            </div>
          ) : (
            <div style={{ padding: 12, color: textColor }}>
              Armory coming soon. Contact admin to enable.
            </div>
          )
        )}
        {tab === 'talentbuilder' && <TalentBuilder textColor={textColor} contentBoxColor={contentBoxColor} token={token} gmLevel={gmLevel} />}
        {tab === 'account' && (
          <div style={{ padding: 24, color: textColor }}>
            <h2 style={{ marginTop: 0 }}>My Account</h2>
            <p style={{ color: '#999' }}>View and manage your account details, characters, and preferences.</p>
            <div style={{ padding: 40, border: '2px dashed #555', borderRadius: 8, textAlign: 'center', color: '#666' }}>
              Coming soon — account management dashboard.
            </div>
          </div>
        )}
        {tab === 'shop' && (
          <div style={{ padding: 24, color: textColor }}>
            <h2 style={{ marginTop: 0 }}>Shop</h2>
            <p style={{ color: '#999' }}>Browse and purchase cosmetics, mounts, pets, and other items.</p>
            <div style={{ padding: 40, border: '2px dashed #555', borderRadius: 8, textAlign: 'center', color: '#666' }}>
              Coming soon — in-game shop.
            </div>
          </div>
        )}
        {tab === 'talenteditor' && (
          gmLevel > 0 ? (
            <TalentEditor textColor={textColor} contentBoxColor={contentBoxColor} />
          ) : (
            <div style={{ padding: 12, color: textColor }}>
              You don't have permission to edit talent trees. Contact admin.
            </div>
          )
        )}
        {tab === 'spellicon' && (
          gmLevel > 0 ? (
            <SpellIconEditor textColor={textColor} contentBoxColor={contentBoxColor} />
          ) : (
            <div style={{ padding: 12, color: textColor }}>
              You don't have permission to edit spell icons. Contact admin.
            </div>
          )
        )}
        {tab === 'serverstarter' && (
          <ServerStarter token={token} baseUrl={starterBase} fileBaseUrl={fileBase} textColor={textColor} contentBoxColor={contentBoxColor} />
        )}
        {tab === 'accountcontrol' && (
          <AccountControl token={token} baseUrl={starterBase} textColor={textColor} contentBoxColor={contentBoxColor} />
        )}
        {tab === 'dbceditor' && (
          gmLevel > 0 ? (
            <DBCEditor textColor={textColor} contentBoxColor={contentBoxColor} />
          ) : (
            <div style={{ padding: 12, color: textColor }}>
              You don't have permission to edit DBC files. Contact admin.
            </div>
          )
        )}
        {tab === 'startingequip' && (
          gmLevel > 0 ? (
            <CharStartOutfitEditor textColor={textColor} contentBoxColor={contentBoxColor} />
          ) : (
            <div style={{ padding: 12, color: textColor }}>
              You don't have permission to edit starting equipment. Contact admin.
            </div>
          )
        )}

        {tab === 'loadingscreen' && (
          gmLevel > 0 ? (
            <div style={{ padding: 24, color: textColor }}>
              <h2 style={{ marginTop: 0 }}>Loading Screen Editor</h2>
              <p style={{ color: '#999' }}>Edit and manage custom loading screens for your WoW client.</p>
              <div style={{ padding: 40, border: '2px dashed #555', borderRadius: 8, textAlign: 'center', color: '#666' }}>
                Coming soon — drag and drop loading screen images here.
              </div>
            </div>
          ) : (
            <div style={{ padding: 12, color: textColor }}>Contact admin to access this editor.</div>
          )
        )}
        {tab === 'itemeditor' && (
          gmLevel > 0 ? (
            <div style={{ padding: 24, color: textColor }}>
              <h2 style={{ marginTop: 0 }}>Item Editor</h2>
              <p style={{ color: '#999' }}>Create and modify custom items, set stats, models, and properties.</p>
              <div style={{ padding: 40, border: '2px dashed #555', borderRadius: 8, textAlign: 'center', color: '#666' }}>
                Coming soon — item creation and editing tools.
              </div>
            </div>
          ) : (
            <div style={{ padding: 12, color: textColor }}>Contact admin to access this editor.</div>
          )
        )}
        {tab === 'spelleditor' && (
          gmLevel > 0 ? (
            <SpellEditor textColor={textColor} contentBoxColor={contentBoxColor} />
          ) : (
            <div style={{ padding: 12, color: textColor }}>Contact admin to access this editor.</div>
          )
        )}
        {tab === 'settings' && (
          gmLevel > 0 ? (
            <div style={{ maxWidth: 1200 }}>
              <h3>Server Settings</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 24 }}>
                {/* Left Column: Color Settings */}
                <div style={{ padding: 16, background: contentBoxColor, borderRadius: 8 }}>
                  <h4 style={{ marginTop: 0 }}>Appearance Settings</h4>
                  
                  {/* Background Color */}
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
                      Background Color
                    </label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <input
                        type="color"
                        value={editingBackgroundColor}
                        onChange={(e) => setEditingBackgroundColor(e.target.value)}
                        style={{ width: 60, height: 40, cursor: 'pointer', border: '1px solid #ccc', borderRadius: 4 }}
                      />
                      <input
                        type="text"
                        value={editingBackgroundColor}
                        onChange={(e) => setEditingBackgroundColor(e.target.value)}
                        style={{ flex: 1, padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
                        placeholder="#ffffff"
                      />
                    </div>
                    <button
                      onClick={onSaveBackgroundColor}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 4,
                        border: 'none',
                        background: '#007bff',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Save
                    </button>
                  </div>

                  {/* Text Color */}
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
                      Text Color
                    </label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <input
                        type="color"
                        value={editingTextColor}
                        onChange={(e) => setEditingTextColor(e.target.value)}
                        style={{ width: 60, height: 40, cursor: 'pointer', border: '1px solid #ccc', borderRadius: 4 }}
                      />
                      <input
                        type="text"
                        value={editingTextColor}
                        onChange={(e) => setEditingTextColor(e.target.value)}
                        style={{ flex: 1, padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
                        placeholder="#000000"
                      />
                    </div>
                    <button
                      onClick={onSaveTextColor}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 4,
                        border: 'none',
                        background: '#007bff',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Save
                    </button>
                  </div>

                  {/* Content Box Color */}
                  <div>
                    <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
                      Content Box Color
                    </label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <input
                        type="color"
                        value={editingContentBoxColor}
                        onChange={(e) => setEditingContentBoxColor(e.target.value)}
                        style={{ width: 60, height: 40, cursor: 'pointer', border: '1px solid #ccc', borderRadius: 4 }}
                      />
                      <input
                        type="text"
                        value={editingContentBoxColor}
                        onChange={(e) => setEditingContentBoxColor(e.target.value)}
                        style={{ flex: 1, padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
                        placeholder="#f9f9f9"
                      />
                    </div>
                    <button
                      onClick={onSaveContentBoxColor}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 4,
                        border: 'none',
                        background: '#007bff',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>

                {/* Right Column: Background Image and Page Icon */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
                  {/* Background Image Upload */}
                  <div style={{ padding: 16, background: contentBoxColor, borderRadius: 8 }}>
                    <h4 style={{ marginTop: 0 }}>Background Image</h4>
                    {backgroundImage ? (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ marginBottom: 8, padding: 8, background: '#e8f5e9', borderRadius: 4, fontSize: 12 }}>
                          ✓ Image set
                        </div>
                        <button
                          onClick={onClearBackground}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 4,
                            border: 'none',
                            background: '#dc3545',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: 12,
                            marginBottom: 8,
                            width: '100%',
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
                        Upload image to override background color.
                      </p>
                    )}
                    <label
                      htmlFor="background-file-input"
                      style={{
                        display: 'block',
                        padding: '6px 12px',
                        background: '#007bff',
                        color: '#fff',
                        borderRadius: 4,
                        cursor: backgroundUploadBusy ? 'not-allowed' : 'pointer',
                        fontSize: 12,
                        opacity: backgroundUploadBusy ? 0.6 : 1,
                        textAlign: 'center',
                      }}
                    >
                      {backgroundUploadBusy ? 'Uploading...' : 'Upload Image'}
                    </label>
                    <input
                      id="background-file-input"
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        if (e.target.files?.[0]) {
                          onBackgroundImageUpload(e.target.files[0]);
                        }
                        e.target.value = '';
                      }}
                      style={{ display: 'none' }}
                      disabled={backgroundUploadBusy}
                    />
                  </div>

                  {/* Page Icon Upload */}
                  <div style={{ padding: 16, background: contentBoxColor, borderRadius: 8 }}>
                    <h4 style={{ marginTop: 0 }}>Page Icon</h4>
                    {pageIconError && (
                      <div style={{ padding: 8, background: '#fee', color: '#b91c1c', borderRadius: 4, marginBottom: 12, fontSize: 12 }}>
                        {pageIconError}
                      </div>
                    )}
                    {pageIcon ? (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ marginBottom: 8, padding: 8, background: '#e8f5e9', borderRadius: 4, fontSize: 12 }}>
                          ✓ Icon set
                        </div>
                        <button
                          onClick={onClearPageIcon}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 4,
                            border: 'none',
                            background: '#dc3545',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: 12,
                            marginBottom: 8,
                            width: '100%',
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
                        Recommended: 192x192 or 256x256 PNG/ICO formats work best.
                      </p>
                    )}
                    <label
                      htmlFor="page-icon-file-input"
                      style={{
                        display: 'block',
                        padding: '6px 12px',
                        background: '#007bff',
                        color: '#fff',
                        borderRadius: 4,
                        cursor: pageIconUploadBusy ? 'not-allowed' : 'pointer',
                        fontSize: 12,
                        opacity: pageIconUploadBusy ? 0.6 : 1,
                        textAlign: 'center',
                      }}
                    >
                      {pageIconUploadBusy ? 'Uploading...' : 'Upload Icon'}
                    </label>
                    <input
                      id="page-icon-file-input"
                      type="file"
                      accept="image/*,.ico"
                      onChange={(e) => {
                        if (e.target.files?.[0]) {
                          onPageIconUpload(e.target.files[0]);
                        }
                        e.target.value = '';
                      }}
                      style={{ display: 'none' }}
                      disabled={pageIconUploadBusy}
                    />
                  </div>
                </div>
              </div>

              {/* Login Title */}
              <div style={{ marginBottom: 24, padding: 16, background: contentBoxColor, borderRadius: 8 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
                  Login Page Title
                </label>
                <input
                  type="text"
                  value={editingLoginTitle}
                  onChange={(e) => setEditingLoginTitle(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 8,
                    borderRadius: 4,
                    border: '1px solid #ccc',
                    marginBottom: 12,
                    boxSizing: 'border-box',
                  }}
                  placeholder="e.g., Surrealabs Server Login"
                />
                <p style={{ fontSize: 12, color: '#666', margin: 0, marginBottom: 12 }}>
                  Currently: <strong>{loginTitle}</strong>
                </p>
                <button
                  onClick={onSaveLoginTitle}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: 'none',
                    background: '#007bff',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Save
                </button>
              </div>

              {/* Page Title */}
              <div style={{ marginBottom: 24, padding: 16, background: contentBoxColor, borderRadius: 8 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
                  Page Title
                </label>
                <input
                  type="text"
                  value={editingPageTitle}
                  onChange={(e) => setEditingPageTitle(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 8,
                    borderRadius: 4,
                    border: '1px solid #ccc',
                    marginBottom: 12,
                    boxSizing: 'border-box',
                  }}
                  placeholder="e.g., Surrealabs Server"
                />
                <p style={{ fontSize: 12, color: '#666', margin: 0, marginBottom: 12 }}>
                  Currently: <strong>{pageTitle}</strong>
                </p>
                <button
                  onClick={onSavePageTitle}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: 'none',
                    background: '#007bff',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  Save
                </button>
              </div>

              {/* Initialize Folders */}
              <div style={{ marginBottom: 24, padding: 16, background: contentBoxColor, borderRadius: 8 }}>
                <h4 style={{ marginTop: 0 }}>Initialize Folders</h4>
                <p style={{ fontSize: 13, color: '#aaa', marginBottom: 12 }}>
                  Create all required public directories (dbc, Icons, thumbnails, sprites, export,
                  error-logs). Existing folders are left untouched.
                </p>
                <FolderInitializer fileBase={fileBase} contentBoxColor={contentBoxColor} />
              </div>
            </div>
          ) : (
            <div style={{ padding: 12, color: '#999' }}>
              Settings can only be accessed by admins.
            </div>
          )
        )}
      </div>
    </div>
  );
}

export default App;
