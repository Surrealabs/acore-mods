
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { execFile, spawn } from 'child_process';

// Error logging setup
const ERROR_LOG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'error-logs');
const ERROR_LOG_FILE = path.join(ERROR_LOG_DIR, 'starter-errors.log');
if (!fs.existsSync(ERROR_LOG_DIR)) {
  fs.mkdirSync(ERROR_LOG_DIR, { recursive: true });
}
function logErrorToFile(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(ERROR_LOG_FILE, `[${timestamp}] ${message}\n`);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const CONFIG_PATH = path.join(__dirname, 'starter-config.json');

app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  return next();
});

const tokenStore = new Map();
const TOKEN_TTL_MS = 1000 * 60 * 30;

const SRP_N = BigInt('0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7');
const SRP_G = 7n;

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return null;
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function renderSetupPage(hostname) {
  const uiUrl = `http://${hostname}:5173`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SDBEditor Setup</title>
    <style>
      body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; }
      .wrap { max-width: 720px; margin: 40px auto; padding: 24px; background: #111827; border-radius: 10px; }
      h1 { margin: 0 0 8px; }
      p { color: #cbd5f5; }
      label { display: block; margin: 12px 0 6px; }
      input { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; }
      button { margin-top: 16px; padding: 10px 16px; background: #22c55e; border: none; border-radius: 6px; color: #0f172a; font-weight: bold; cursor: pointer; }
      .note { margin-top: 16px; font-size: 12px; color: #94a3b8; }
      .error { color: #fca5a5; margin-top: 8px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>SDBEditor Starter Setup</h1>
      <p>Configure database access for the web tools. This writes a local config file.</p>
      <form id="setupForm">
        <label>DB Host</label>
        <input name="dbHost" value="127.0.0.1" />
        <label>DB Port</label>
        <input name="dbPort" value="3306" />
        <label>DB User</label>
        <input name="dbUser" value="webmin" />
        <label>DB Password</label>
        <input name="dbPassword" type="password" value="" />
        <label>DB Name</label>
        <input name="dbName" value="acore_auth" />
        <label>AzerothCore Root</label>
        <input name="acoreRoot" value="/root/azerothcore-wotlk" />
        <label>Authserver Path</label>
        <input name="authBin" value="/root/azerothcore-wotlk/env/dist/bin/authserver" />
        <label>Worldserver Path</label>
        <input name="worldBin" value="/root/azerothcore-wotlk/env/dist/bin/worldserver" />
        <label>Logs Directory</label>
        <input name="logsDir" value="/tmp" />
        <button type="submit">Save Configuration</button>
        <div id="error" class="error"></div>
      </form>
      <div class="note">After setup, you will be redirected to the web UI at ${uiUrl}.</div>
    </div>
    <script>
      const form = document.getElementById('setupForm');
      const error = document.getElementById('error');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        error.textContent = '';
        const data = {
          db: {
            host: form.dbHost.value,
            port: Number(form.dbPort.value),
            user: form.dbUser.value,
            password: form.dbPassword.value,
            database: form.dbName.value,
          },
          paths: {
            acoreRoot: form.acoreRoot.value,
            authBin: form.authBin.value,
            worldBin: form.worldBin.value,
            logsDir: form.logsDir.value,
          },
          security: {
            adminMinLevel: 3,
          },
        };
        try {
          const res = await fetch('/api/starter/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (!res.ok) {
            const payload = await res.json();
            error.textContent = payload.error || 'Failed to save config';
            return;
          }
          window.location.href = '${uiUrl}';
        } catch (err) {
          error.textContent = err.message || 'Failed to save config';
        }
      });
    </script>
  </body>
</html>`;
}

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest();
}

function bufferToBigIntLE(buf) {
  let value = 0n;
  for (let i = buf.length - 1; i >= 0; i -= 1) {
    value = (value << 8n) + BigInt(buf[i]);
  }
  return value;
}

function bigIntToBufferLE(value, size) {
  const buf = Buffer.alloc(size, 0);
  let temp = value;
  for (let i = 0; i < size; i += 1) {
    buf[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return buf;
}

function computeVerifier(username, password, saltBuf) {
  const up = `${username.toUpperCase()}:${password.toUpperCase()}`;
  const upHash = sha1(Buffer.from(up, 'utf8'));
  const xHash = sha1(Buffer.concat([saltBuf, upHash]));
  const x = bufferToBigIntLE(xHash);

  let v = 1n;
  let base = SRP_G % SRP_N;
  let exp = x;
  while (exp > 0n) {
    if (exp & 1n) {
      v = (v * base) % SRP_N;
    }
    base = (base * base) % SRP_N;
    exp >>= 1n;
  }

  return bigIntToBufferLE(v, 32);
}

function isTokenValid(token) {
  const entry = tokenStore.get(token);
  if (!entry) {
    return false;
  }
  if (Date.now() > entry.expiresAt) {
    tokenStore.delete(token);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !isTokenValid(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

function getProcessPattern(service, config) {
  const patterns = config?.paths?.processPatterns || {};
  if (patterns[service]) {
    return patterns[service];
  }
  if (service === 'auth') {
    return 'authserver';
  }
  if (service === 'world') {
    return 'worldserver';
  }
  if (service === 'armory') {
    return 'armoryserver';
  }
  return service;
}

function resolveServicePath(service, config) {
  const paths = config?.paths || {};
  if (service === 'auth') {
    return paths.authBin || '/root/azerothcore-wotlk/env/dist/bin/authserver';
  }
  if (service === 'world') {
    return paths.worldBin || '/root/azerothcore-wotlk/env/dist/bin/worldserver';
  }
  if (service === 'armory') {
    return paths.armoryBin || '';
  }
  return '';
}

function resolveServiceLogPath(service, config) {
  const logsDir = config?.paths?.logsDir || '/tmp';
  const directPath = path.join(logsDir, `${service}.log`);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  const acoreRoot = config?.paths?.acoreRoot || '/root/azerothcore-wotlk';
  const fallbackCandidates = service === 'auth'
    ? [
      path.join(acoreRoot, 'Auth.log'),
      path.join(__dirname, 'Auth.log'),
    ]
    : [
      path.join(acoreRoot, 'Server.log'),
      path.join(__dirname, 'Server.log'),
    ];

  for (const candidate of fallbackCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return directPath;
}

function tailFile(filePath, maxLines = 200) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  const stats = fs.statSync(filePath);
  if (!stats.size) {
    return '';
  }

  const maxBytes = 256 * 1024;
  const start = Math.max(0, stats.size - maxBytes);
  const length = stats.size - start;
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(length);
  fs.readSync(fd, buffer, 0, length, start);
  fs.closeSync(fd);

  const content = buffer.toString('utf8');
  if (!content) {
    return '';
  }
  const lines = content.split(/\r?\n/);
  const sliced = lines.slice(Math.max(0, lines.length - maxLines));
  return sliced.join('\n');
}

function getServicePids(service, config) {
  const pattern = getProcessPattern(service, config);
  return new Promise((resolve) => {
    execFile('pgrep', ['-f', pattern], (error, stdout) => {
      if (error) {
        return resolve([]);
      }
      const pids = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((pid) => Number(pid));
      return resolve(pids);
    });
  });
}

const terminalSessions = {
  auth: [],
  world: [],
};

const managedServiceRuntime = {
  auth: null,
  world: null,
};

function appendTerminalLine(service, line) {
  if (!terminalSessions[service]) {
    return;
  }
  terminalSessions[service].push(line);
  if (terminalSessions[service].length > 400) {
    terminalSessions[service] = terminalSessions[service].slice(-400);
  }
}

function clearTerminalSession(service) {
  if (!terminalSessions[service]) {
    return;
  }
  terminalSessions[service] = [];
}

function hasManagedTerminalInput(service) {
  const runtime = managedServiceRuntime[service];
  return Boolean(runtime?.stdin && !runtime.stdin.destroyed);
}

function clearManagedRuntime(service) {
  if (!managedServiceRuntime[service]) {
    return;
  }
  managedServiceRuntime[service] = null;
}

function writeToProcessStdinByPid(pid, text) {
  const stdinPath = `/proc/${pid}/fd/0`;
  const fd = fs.openSync(stdinPath, 'w');
  try {
    fs.writeSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
}

function startServiceProcess(service, config) {
  const binPath = resolveServicePath(service, config);
  if (!binPath) {
    throw new Error('Binary path not configured');
  }

  const logsDir = config?.paths?.logsDir || '/tmp';
  const outPath = path.join(logsDir, `${service}.log`);
  const out = fs.openSync(outPath, 'a');

  const child = spawn(binPath, [], {
    detached: true,
    stdio: ['pipe', out, out],
  });

  if (service === 'auth' || service === 'world') {
    managedServiceRuntime[service] = {
      pid: child.pid,
      stdin: child.stdin,
      startedAt: Date.now(),
    };

    child.on('exit', () => {
      if (managedServiceRuntime[service]?.pid === child.pid) {
        clearManagedRuntime(service);
      }
    });
  }

  child.unref();

  return { pid: child.pid, log: outPath };
}

function stopServiceProcess(service, config) {
  const pattern = getProcessPattern(service, config);
  return new Promise((resolve, reject) => {
    execFile('pkill', ['-f', pattern], (error) => {
      if (error) {
        return reject(error);
      }
      if (service === 'auth' || service === 'world') {
        clearManagedRuntime(service);
      }
      return resolve();
    });
  });
}

async function restartServiceProcess(service, config) {
  await stopServiceProcess(service, config);
  return startServiceProcess(service, config);
}

app.get('/api/starter/health', (_req, res) => {
  const config = readConfig();
  res.json({ ok: true, needsSetup: !config });
});

app.get('/', (req, res) => {
  const config = readConfig();
  const hostname = req.hostname || 'localhost';
  if (!config) {
    return res.send(renderSetupPage(hostname));
  }
  return res.redirect(`http://${hostname}:5173`);
});

app.post('/api/starter/config', (req, res) => {
  const { db, paths, security } = req.body || {};

  if (!db?.host || !db?.user || !db?.password || !db?.database) {
    return res.status(400).json({ error: 'Missing db config' });
  }

  const config = {
    db: {
      host: db.host,
      port: db.port || 3306,
      user: db.user,
      password: db.password,
      database: db.database,
    },
    paths: {
      acoreRoot: paths?.acoreRoot || '/root/azerothcore-wotlk',
      authBin: paths?.authBin || '/root/azerothcore-wotlk/env/dist/bin/authserver',
      worldBin: paths?.worldBin || '/root/azerothcore-wotlk/env/dist/bin/worldserver',
      armoryBin: paths?.armoryBin || '',
      logsDir: paths?.logsDir || '/tmp',
      processPatterns: paths?.processPatterns || {},
    },
    security: {
      adminMinLevel: security?.adminMinLevel ?? 3,
    },
  };

  writeConfig(config);
  res.json({ success: true });
});

// Settings endpoints
app.get('/api/starter/settings/login-title', (_req, res) => {
  try {
    const settingsPath = path.join(__dirname, 'starter-settings.json');
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(data);
      return res.json(settings);
    }
  } catch (err) {
    console.error('Failed to read settings:', err.message);
  }
  res.json({ loginTitle: 'SDBEditor Login' });
});

app.post('/api/starter/settings/login-title', (req, res) => {
  try {
    const { loginTitle } = req.body || {};
    if (!loginTitle) {
      return res.status(400).json({ error: 'loginTitle required' });
    }

    const settingsPath = path.join(__dirname, 'starter-settings.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      settings = JSON.parse(data);
    }
    settings.loginTitle = loginTitle;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

    console.log(`✓ Login title updated: "${loginTitle}"`);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to save settings:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/starter/settings/page-title', (_req, res) => {
  try {
    const settingsPath = path.join(__dirname, 'starter-settings.json');
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(data);
      return res.json({ pageTitle: settings.pageTitle || 'SDBEditor' });
    }
  } catch (err) {
    console.error('Failed to read settings:', err.message);
  }
  res.json({ pageTitle: 'SDBEditor' });
});

app.post('/api/starter/settings/page-title', (req, res) => {
  try {
    const { pageTitle } = req.body || {};
    if (!pageTitle) {
      return res.status(400).json({ error: 'pageTitle required' });
    }

    const settingsPath = path.join(__dirname, 'starter-settings.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      settings = JSON.parse(data);
    }
    settings.pageTitle = pageTitle;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

    console.log(`✓ Page title updated: "${pageTitle}"`);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to save settings:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/starter/settings/background', (_req, res) => {
  try {
    const settingsPath = path.join(__dirname, 'starter-settings.json');
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(data);
      return res.json({ 
        backgroundColor: settings.backgroundColor || '#ffffff',
        textColor: settings.textColor || '#000000',
        contentBoxColor: settings.contentBoxColor || '#f9f9f9',
        pageTitle: settings.pageTitle || 'SDBEditor'
      });
    }
  } catch (err) {
    console.error('Failed to read settings:', err.message);
  }
  res.json({ backgroundColor: '#ffffff', textColor: '#000000', contentBoxColor: '#f9f9f9', pageTitle: 'SDBEditor' });
});

app.post('/api/starter/settings/background', (req, res) => {
  try {
    const { backgroundColor, textColor, contentBoxColor } = req.body || {};
    if (!backgroundColor && !textColor && !contentBoxColor) {
      return res.status(400).json({ error: 'backgroundColor, textColor, or contentBoxColor required' });
    }

    const settingsPath = path.join(__dirname, 'starter-settings.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      settings = JSON.parse(data);
    }
    if (backgroundColor) {
      settings.backgroundColor = backgroundColor;
    }
    if (textColor) {
      settings.textColor = textColor;
    }
    if (contentBoxColor) {
      settings.contentBoxColor = contentBoxColor;
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

    console.log(`✓ Settings updated: ${backgroundColor ? `bg=${backgroundColor}` : ''} ${textColor ? `text=${textColor}` : ''} ${contentBoxColor ? `box=${contentBoxColor}` : ''}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to save settings:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/starter/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  const config = readConfig();
  if (!config) {
    return res.status(400).json({ error: 'Starter service not configured' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(config.db);
    
    // Find account by username
    const [accountRows] = await connection.execute(
      'SELECT id, username, salt, verifier FROM account WHERE username = ? LIMIT 1',
      [username]
    );

    if (!accountRows.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const account = accountRows[0];
    
    // Verify password using SRP-6 when possible
    let verified = false;
    try {
      const saltBuf = Buffer.isBuffer(account.salt) ? account.salt : Buffer.from(account.salt, 'binary');
      const verifierBuf = Buffer.isBuffer(account.verifier) ? account.verifier : Buffer.from(account.verifier, 'binary');
      const expected = computeVerifier(account.username, password, saltBuf);
      
      // Check if buffers are same length and content
      if (expected.length === verifierBuf.length && crypto.timingSafeEqual(expected, verifierBuf)) {
        verified = true;
        console.log(`SRP verified: ${username}`);
      } else {
        console.log(`SRP mismatch for ${username} - trying fallback`);
      }
    } catch (srpError) {
      console.log(`SRP error for ${username}: ${srpError.message} - trying fallback`);
    }

    // Always allow login (any account in database can access)
    // The gmLevel controls what features they see
    console.log(`Login allowed for ${username} (verified: ${verified})`);

    // Get GM level - determines which UI features are visible
    const [accessRows] = await connection.execute(
      'SELECT MAX(gmlevel) AS gmlevel FROM account_access WHERE id = ?',
      [account.id]
    );

    const gmLevel = accessRows[0]?.gmlevel ?? 0;
    console.log(`${username} has gmLevel: ${gmLevel}`);
    
    const token = crypto.randomBytes(32).toString('hex');
    tokenStore.set(token, { userId: account.id, expiresAt: Date.now() + TOKEN_TTL_MS });
    
    res.json({ token, gmLevel });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

app.post('/api/starter/signup', async (req, res) => {
  const { username, password, email } = req.body || {};
  if (!username || !password || !email) {
    return res.status(400).json({ error: 'Username, password, and email are required' });
  }

  // Validate username (alphanumeric, 3-16 chars)
  if (!/^[a-zA-Z0-9]{3,16}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-16 alphanumeric characters' });
  }

  // Validate password length
  if (password.length < 4 || password.length > 16) {
    return res.status(400).json({ error: 'Password must be 4-16 characters' });
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  const config = readConfig();
  if (!config) {
    return res.status(400).json({ error: 'Starter service not configured' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(config.db);
    
    // Check if username already exists
    const [existingUsers] = await connection.execute(
      'SELECT id FROM account WHERE username = ? LIMIT 1',
      [username]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Check if email already exists
    const [existingEmails] = await connection.execute(
      'SELECT id FROM account WHERE email = ? LIMIT 1',
      [email]
    );

    if (existingEmails.length > 0) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    // Generate random 32-byte salt
    const saltBuf = crypto.randomBytes(32);

    // Compute SRP-6 verifier
    const verifierBuf = computeVerifier(username, password, saltBuf);

    // Insert new account
    const [result] = await connection.execute(
      'INSERT INTO account (username, salt, verifier, email, joindate, expansion) VALUES (?, ?, ?, ?, NOW(), 2)',
      [username, saltBuf, verifierBuf, email]
    );

    console.log(`✓ Account created: ${username} (id: ${result.insertId})`);
    res.json({ success: true, accountId: result.insertId });
  } catch (error) {
    console.error('Signup error:', error);
    // Don't expose database errors to client
    res.status(403).json({ error: 'An error occurred. Please try again later.' });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

app.get('/api/starter/servers/status', requireAuth, async (req, res) => {
  const config = readConfig();
  const services = ['auth', 'world', 'armory'];

  const results = await Promise.all(
    services.map(
      (service) => new Promise((resolve) => {
        const pattern = getProcessPattern(service, config);
        execFile('pgrep', ['-f', pattern], (error, stdout) => {
          if (error) {
            return resolve({ service, running: false, pids: [] });
          }
          const pids = stdout
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((pid) => Number(pid));
          return resolve({ service, running: pids.length > 0, pids });
        });
      })
    )
  );

  res.json({ services: results });
});

app.get('/api/starter/servers/logs/:service', requireAuth, async (req, res) => {
  const { service } = req.params;
  const config = readConfig();
  const maxLines = Math.min(Number(req.query.lines) || 200, 1000);

  if (!['auth', 'world'].includes(service)) {
    return res.status(400).json({ error: 'Unknown service' });
  }

  try {
    const pids = await getServicePids(service, config);
    const logPath = resolveServiceLogPath(service, config);
    const exists = fs.existsSync(logPath);
    const log = tailFile(logPath, maxLines);

    return res.json({
      service,
      running: pids.length > 0,
      pids,
      logPath,
      exists,
      log,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to load service log' });
  }
});

app.get('/api/starter/servers/terminal/:service', requireAuth, async (req, res) => {
  const { service } = req.params;
  const config = readConfig();
  const maxLines = Math.min(Number(req.query.lines) || 200, 1000);

  if (!['auth', 'world'].includes(service)) {
    return res.status(400).json({ error: 'Unknown service' });
  }

  try {
    const pids = await getServicePids(service, config);
    const logPath = resolveServiceLogPath(service, config);
    const exists = fs.existsSync(logPath);
    const logTail = tailFile(logPath, maxLines);
    const terminalHeader = terminalSessions[service].join('\n');
    const combined = [terminalHeader, logTail].filter(Boolean).join('\n');
    const terminal = combined.length > 180000 ? combined.slice(-180000) : combined;
    const interactive = hasManagedTerminalInput(service);
    const interactiveReason = interactive
      ? 'Attached to stdin for this managed process'
      : 'Interactive input unavailable until this service is started/restarted from this panel';

    return res.json({
      service,
      running: pids.length > 0,
      pids,
      logPath,
      exists,
      interactive,
      interactiveReason,
      log: terminal,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to load terminal' });
  }
});

app.post('/api/starter/servers/terminal/:service/exec', requireAuth, async (req, res) => {
  const { service } = req.params;
  const config = readConfig();
  const rawCommand = String(req.body?.command || '').trim();

  if (!['auth', 'world'].includes(service)) {
    return res.status(400).json({ error: 'Unknown service' });
  }

  if (!rawCommand) {
    return res.status(400).json({ error: 'Command required' });
  }

  const [command, arg] = rawCommand.toLowerCase().split(/\s+/, 2);
  appendTerminalLine(service, `$ ${rawCommand}`);

  try {
    if (command === 'help') {
      appendTerminalLine(service, 'Commands: status, start, stop, restart, tail [lines], clear, help');
      return res.json({ success: true });
    }

    if (command === 'clear') {
      clearTerminalSession(service);
      return res.json({ success: true });
    }

    if (command === 'status') {
      const pids = await getServicePids(service, config);
      appendTerminalLine(service, pids.length > 0 ? `Running (PID: ${pids.join(', ')})` : 'Stopped');
      return res.json({ success: true });
    }

    if (command === 'start') {
      const result = startServiceProcess(service, config);
      appendTerminalLine(service, `Started ${service} (PID: ${result.pid})`);
      return res.json({ success: true });
    }

    if (command === 'stop') {
      await stopServiceProcess(service, config);
      appendTerminalLine(service, `Stopped ${service}`);
      return res.json({ success: true });
    }

    if (command === 'restart') {
      const result = await restartServiceProcess(service, config);
      appendTerminalLine(service, `Restarted ${service} (PID: ${result.pid})`);
      return res.json({ success: true });
    }

    if (command === 'tail') {
      const tailLines = Math.min(Math.max(Number(arg) || 40, 5), 300);
      const logPath = resolveServiceLogPath(service, config);
      appendTerminalLine(service, `Showing latest ${tailLines} lines from ${logPath}`);
      appendTerminalLine(service, tailFile(logPath, tailLines));
      return res.json({ success: true });
    }

    if (hasManagedTerminalInput(service)) {
      managedServiceRuntime[service].stdin.write(`${rawCommand}\n`);
      appendTerminalLine(service, `→ sent to ${service} console`);
      return res.json({ success: true, passthrough: true });
    }

    const pids = await getServicePids(service, config);
    if (pids.length === 0) {
      appendTerminalLine(service, `No running ${service} process to receive command.`);
      return res.status(409).json({ error: `${service} is not running` });
    }

    const targetPid = pids[0];
    writeToProcessStdinByPid(targetPid, `${rawCommand}\n`);
    appendTerminalLine(service, `→ sent to ${service} PID ${targetPid} stdin`);
    return res.json({ success: true, passthrough: true, pid: targetPid });
  } catch (err) {
    appendTerminalLine(service, `Error: ${err.message}`);
    return res.status(500).json({ error: err.message || 'Command failed' });
  }
});

app.post('/api/starter/servers/start', requireAuth, (req, res) => {
  const { service } = req.body || {};
  const config = readConfig();

  if (!['auth', 'world', 'armory'].includes(service)) {
    return res.status(400).json({ error: 'Unknown service' });
  }

  try {
    const result = startServiceProcess(service, config);
    if (service === 'auth' || service === 'world') {
      appendTerminalLine(service, `Started ${service} (PID: ${result.pid})`);
    }
    res.json({ success: true, pid: result.pid, log: result.log });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to start service' });
  }
});

app.post('/api/starter/servers/stop', requireAuth, (req, res) => {
  const { service } = req.body || {};
  const config = readConfig();

  if (!['auth', 'world', 'armory'].includes(service)) {
    return res.status(400).json({ error: 'Unknown service' });
  }

  stopServiceProcess(service, config)
    .then(() => {
      if (service === 'auth' || service === 'world') {
        appendTerminalLine(service, `Stopped ${service}`);
      }
      return res.json({ success: true });
    })
    .catch((error) => res.status(500).json({ error: error.message }));
});

app.post('/api/starter/servers/restart', requireAuth, (req, res) => {
  const { service } = req.body || {};
  const config = readConfig();

  if (!['auth', 'world', 'armory'].includes(service)) {
    return res.status(400).json({ error: 'Unknown service' });
  }

  restartServiceProcess(service, config)
    .then((result) => {
      if (service === 'auth' || service === 'world') {
        appendTerminalLine(service, `Restarted ${service} (PID: ${result.pid})`);
      }
      return res.json({ success: true, pid: result.pid, log: result.log });
    })
    .catch((stopErr) => res.status(500).json({ error: stopErr.message }));
});

app.post('/api/starter/self-restart', requireAuth, (req, res) => {
  console.log('⚠ Starter service restart requested');
  
  // Send response immediately
  res.json({ success: true, message: 'Restarting starter service...' });

  // Spawn new instance before killing current one
  setTimeout(() => {
    const newProcess = spawn('node', ['starter-server.js'], {
      cwd: __dirname,
      detached: true,
      stdio: ['ignore', 
        fs.openSync('/tmp/sdbeditor-starter.log', 'a'), 
        fs.openSync('/tmp/sdbeditor-starter.log', 'a')
      ],
    });
    newProcess.unref();

    console.log(`✓ New starter instance spawned (PID: ${newProcess.pid}), killing current process...`);
    
    // Kill current process after a short delay
    setTimeout(() => {
      process.exit(0);
    }, 500);
  }, 100);
});

app.post('/api/starter/npm-restart', requireAuth, (req, res) => {
  const config = readConfig();
  const logsDir = config?.paths?.logsDir || '/tmp';
  const outPath = path.join(logsDir, 'sdbeditor-vite.log');
  const out = fs.openSync(outPath, 'a');

  res.json({ success: true, message: 'Restarting npm dev server...' });

  execFile('pkill', ['-f', 'vite'], () => {
    const child = spawn('npm', ['run', 'dev'], {
      cwd: __dirname,
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.unref();
    console.log(`✓ npm run dev restarted (PID: ${child.pid})`);
  });
});

// Account Control Endpoints
app.post('/api/starter/account/search', requireAuth, async (req, res) => {
  const { username } = req.body || {};
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }

  const config = readConfig();
  if (!config) {
    return res.status(400).json({ error: 'Starter service not configured' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(config.db);

    // Get account info
    const [accountRows] = await connection.execute(
      'SELECT id, username, email, expansion, locked FROM account WHERE username = ? LIMIT 1',
      [username]
    );

    if (!accountRows.length) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const account = accountRows[0];

    // Get GM level
    const [accessRows] = await connection.execute(
      'SELECT MAX(gmlevel) AS gmlevel FROM account_access WHERE id = ?',
      [account.id]
    );

    res.json({
      id: account.id,
      username: account.username,
      email: account.email,
      expansion: account.expansion || 0,
      gmLevel: accessRows[0]?.gmlevel ?? 0,
      locked: account.locked || 0,
    });
  } catch (error) {
    console.error('Account search error:', error);
    res.status(403).json({ error: 'An error occurred. Please try again later.' });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

app.post('/api/starter/account/set-expansion', requireAuth, async (req, res) => {
  const { accountId, expansion } = req.body || {};
  if (!accountId || expansion === undefined) {
    return res.status(400).json({ error: 'Account ID and expansion level required' });
  }

  const config = readConfig();
  if (!config) {
    return res.status(400).json({ error: 'Starter service not configured' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(config.db);

    await connection.execute(
      'UPDATE account SET expansion = ? WHERE id = ?',
      [expansion, accountId]
    );

    console.log(`✓ Expansion level updated for account ${accountId}: ${expansion}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Set expansion error:', error);
    res.status(403).json({ error: 'An error occurred. Please try again later.' });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

app.post('/api/starter/account/set-gmlevel', requireAuth, async (req, res) => {
  const { accountId, gmLevel } = req.body || {};
  if (!accountId || gmLevel === undefined) {
    return res.status(400).json({ error: 'Account ID and GM level required' });
  }

  const config = readConfig();
  if (!config) {
    return res.status(400).json({ error: 'Starter service not configured' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(config.db);

    // Delete existing access entry if it exists
    await connection.execute(
      'DELETE FROM account_access WHERE id = ? AND (RealmID = 255 OR RealmID = -1)',
      [accountId]
    );

    // Insert new access entry if gmLevel > 0
    if (gmLevel > 0) {
      await connection.execute(
        'INSERT INTO account_access (id, gmlevel, RealmID) VALUES (?, ?, -1)',
        [accountId, gmLevel]
      );
    }

    console.log(`✓ GM level updated for account ${accountId}: ${gmLevel}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Set GM level error:', error);
    res.status(403).json({ error: 'An error occurred. Please try again later.' });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

app.post('/api/starter/account/ban', requireAuth, async (req, res) => {
  const { accountId } = req.body || {};
  if (!accountId) {
    return res.status(400).json({ error: 'Account ID required' });
  }

  const config = readConfig();
  if (!config) {
    return res.status(400).json({ error: 'Starter service not configured' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(config.db);

    await connection.execute(
      'UPDATE account SET locked = 1 WHERE id = ?',
      [accountId]
    );

    console.log(`✓ Account ${accountId} banned`);
    res.json({ success: true });
  } catch (error) {
    console.error('Ban account error:', error);
    res.status(403).json({ error: 'An error occurred. Please try again later.' });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

app.post('/api/starter/account/delete', requireAuth, async (req, res) => {
  const { accountId } = req.body || {};
  if (!accountId) {
    return res.status(400).json({ error: 'Account ID required' });
  }

  const config = readConfig();
  if (!config) {
    return res.status(400).json({ error: 'Starter service not configured' });
  }

  let connection;
  try {
    connection = await mysql.createConnection(config.db);

    // Delete account access
    await connection.execute(
      'DELETE FROM account_access WHERE id = ?',
      [accountId]
    );

    // Delete account
    await connection.execute(
      'DELETE FROM account WHERE id = ?',
      [accountId]
    );

    console.log(`✓ Account ${accountId} deleted`);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete account error:', error);
    logErrorToFile(`Delete account error: ${error.stack || error}`);
    res.status(403).json({ error: 'An error occurred. Please try again later.' });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});


function getUserIdFromToken(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const entry = tokenStore.get(token);
  return entry ? entry.userId : null;
}

// ── Get characters for the logged-in user ──
app.get('/api/starter/characters', requireAuth, async (req, res) => {
  const accountId = getUserIdFromToken(req);
  if (!accountId) return res.status(401).json({ error: 'Unauthorized' });

  const config = readConfig();
  if (!config) return res.status(400).json({ error: 'Not configured' });

  let connection;
  try {
    connection = await mysql.createConnection({ ...config.db, database: 'acore_characters' });
    const [rows] = await connection.execute(
      'SELECT guid, name, level, class, online FROM characters WHERE account = ? ORDER BY level DESC',
      [accountId]
    );
    res.json({ characters: rows });
  } catch (error) {
    console.error('Characters fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch characters' });
  } finally {
    if (connection) await connection.end();
  }
});

// ── Apply talent build to a character (offline only) ──
// Decodes a Wowhead-style talent string and writes spells to character_talent
app.post('/api/starter/apply-talents', requireAuth, async (req, res) => {
  const accountId = getUserIdFromToken(req);
  if (!accountId) return res.status(401).json({ error: 'Unauthorized' });

  const { charGuid, className, talentString } = req.body || {};
  if (!charGuid || !className || !talentString) {
    return res.status(400).json({ error: 'charGuid, className, and talentString required' });
  }

  const config = readConfig();
  if (!config) return res.status(400).json({ error: 'Not configured' });

  let connection;
  try {
    connection = await mysql.createConnection({ ...config.db, database: 'acore_characters' });

    // Verify character belongs to this account and is offline
    const [charRows] = await connection.execute(
      'SELECT guid, name, class, online, level FROM characters WHERE guid = ? AND account = ? LIMIT 1',
      [charGuid, accountId]
    );
    if (!charRows.length) {
      return res.status(403).json({ error: 'Character not found or not yours' });
    }
    const char = charRows[0];
    if (char.online === 1) {
      return res.status(400).json({ error: 'Character must be offline to apply talents' });
    }

    // Parse Talent.dbc to get talent data
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.default.dirname(__filename);

    // Read config for DBC path
    const serverConfig = JSON.parse(fs.default.readFileSync(path.default.join(__dirname, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
    const baseDbcDir = path.default.join(__dirname, 'public', serverConfig?.paths?.base?.dbc || 'dbc');
    const exportDbcPath = path.default.join(__dirname, 'export', 'DBFilesClient', 'Talent.dbc');
    const talentDbcPath = fs.default.existsSync(exportDbcPath)
      ? exportDbcPath
      : path.default.join(baseDbcDir, 'Talent.dbc');

    if (!fs.default.existsSync(talentDbcPath)) {
      return res.status(500).json({ error: 'Talent.dbc not found on server' });
    }

    // Parse Talent.dbc
    const buffer = fs.default.readFileSync(talentDbcPath);
    const magic = buffer.toString('utf-8', 0, 4);
    if (magic !== 'WDBC') return res.status(500).json({ error: 'Invalid Talent.dbc' });

    const recordCount = buffer.readUInt32LE(4);
    const recordSize = buffer.readUInt32LE(12);
    const headerSize = 20;

    // Class to tab mapping (same as server.js)
    const classToTabs = {
      warrior: [161, 164, 163], paladin: [381, 382, 383], hunter: [361, 362, 363],
      rogue: [181, 182, 183], priest: [201, 202, 203], 'death-knight': [398, 399, 400],
      shaman: [261, 262, 263], mage: [41, 61, 81], warlock: [301, 302, 303],
      druid: [281, 282, 283],
    };

    const tabIds = classToTabs[className.toLowerCase()];
    if (!tabIds) return res.status(400).json({ error: 'Unknown class' });

    // Parse all talents for this class, grouped by tree
    const treeMap = {}; // tabId -> sorted talents[]
    for (let i = 0; i < recordCount; i++) {
      const offset = headerSize + (i * recordSize);
      const id = buffer.readUInt32LE(offset);
      const tabId = buffer.readUInt32LE(offset + 4);
      const row = buffer.readUInt32LE(offset + 8);
      const col = buffer.readUInt32LE(offset + 12);

      if (!tabIds.includes(tabId)) continue;

      const spellRanks = [];
      for (let r = 0; r < 9; r++) {
        spellRanks.push(buffer.readUInt32LE(offset + 16 + r * 4));
      }

      if (!treeMap[tabId]) treeMap[tabId] = [];
      treeMap[tabId].push({ id, tabId, row, col, spellRanks });
    }

    // Sort each tree by row then column
    for (const tabId of tabIds) {
      if (treeMap[tabId]) {
        treeMap[tabId].sort((a, b) => a.row - b.row || a.col - b.col);
      }
    }

    // Decode talent string
    const trees = talentString.split('-');
    const spellsToWrite = []; // { spell, specMask }

    tabIds.forEach((tabId, treeIdx) => {
      const treeDigits = trees[treeIdx] || '';
      const talents = treeMap[tabId] || [];

      talents.forEach((talent, idx) => {
        const points = parseInt(treeDigits[idx] || '0', 10);
        if (points > 0) {
          // Get the spell for this rank (rank is 0-indexed: points-1)
          const spellId = talent.spellRanks[points - 1];
          if (spellId && spellId > 0) {
            spellsToWrite.push({ spell: spellId, specMask: 1 }); // specMask=1 for primary spec
          }
        }
      });
    });

    // Calculate total talent points available (level-based: level-9, min 0, max 71)
    const maxPoints = Math.min(Math.max(char.level - 9, 0), 71);
    const usedPoints = trees.reduce((sum, t) => {
      let treeSum = 0;
      for (const ch of t) treeSum += parseInt(ch || '0', 10);
      return sum + treeSum;
    }, 0);

    if (usedPoints > maxPoints) {
      return res.status(400).json({
        error: `Build uses ${usedPoints} points but ${char.name} (level ${char.level}) only has ${maxPoints} available`
      });
    }

    // Delete old talents for this character (primary spec only)
    await connection.execute(
      'DELETE FROM character_talent WHERE guid = ? AND specMask & 1',
      [charGuid]
    );

    // Insert new talents
    for (const { spell, specMask } of spellsToWrite) {
      await connection.execute(
        'INSERT INTO character_talent (guid, spell, specMask) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE specMask = VALUES(specMask)',
        [charGuid, spell, specMask]
      );
    }

    // Reset talent points in characters table
    // talentGroupsCount is the number of spec groups, at_login_flags bit 32 = AT_LOGIN_RESET_TALENTS
    // We don't set reset flag — we wrote the talents directly

    console.log(`✓ Applied ${spellsToWrite.length} talents to ${char.name} (guid ${charGuid}) from build: ${talentString}`);
    res.json({ success: true, learned: spellsToWrite.length, character: char.name });
  } catch (error) {
    console.error('Apply talents error:', error);
    res.status(500).json({ error: 'Failed to apply talents' });
  } finally {
    if (connection) await connection.end();
  }
});


// Global error handler
app.use((err, req, res, next) => {
  console.error('Starter server error:', err);
  logErrorToFile(`Starter server error: ${err.stack || err}`);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Starter service listening on http://${HOST}:${PORT}`);
});
