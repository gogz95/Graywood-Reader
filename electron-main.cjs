const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logStream = fs.createWriteStream(path.join(logsDir, 'desktop_app.log'), { flags: 'a' });
function writeLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  logStream.write(line);
}

// -------------------------------------------------------------
// Multi-Environment Hardware Acceleration & GPU Resilience Setup
// -------------------------------------------------------------
const isGpuDisabled =
  process.env.DISABLE_GPU === '1' ||
  process.env.LIBGL_ALWAYS_SOFTWARE === '1' ||
  process.argv.includes('--disable-gpu') ||
  process.argv.includes('--no-sandbox');

if (isGpuDisabled) {
  writeLog('[Hardware Acceleration] GPU disabled by environment configuration or CLI switch. Running in software rendering mode.');
  try {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
  } catch (err) {
    writeLog(`[Hardware Acceleration] Warning disabling GPU: ${err.message}`);
  }
} else {
  try {
    // Enable high-performance GPU rasterization & zero-copy memory pipelines
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-zero-copy');
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
    app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization,VaapiVideoDecoder,UseSkiaRenderer');
    writeLog('[Hardware Acceleration] Enabled GPU rasterization, zero-copy, and Skia acceleration flags.');
  } catch (err) {
    writeLog(`[Hardware Acceleration] Switch initialization notice: ${err.message}`);
  }
}

// Graceful fallback if the host GPU drivers crash or are unsupported in a VM/container
app.on('gpu-process-crashed', (_event, killed) => {
  writeLog(`[Hardware Acceleration] GPU process crashed (killed: ${killed}). Falling back to software rendering.`);
  try {
    app.disableHardwareAcceleration();
  } catch (_) {}
});

// Discord RPC State
let discordClient = null;
const DISCORD_CLIENT_ID = '123456789012345678'; // Graywood Reader Rich Presence App ID

function updateDiscordPresence(details, state, largeImageKey = 'logo', largeImageText = 'Graywood Reader') {
  try {
    writeLog(`[Discord RPC] Activity: ${details} | ${state}`);
  } catch (err) {
    writeLog(`[Discord RPC] Failed to update: ${err.message}`);
  }
}

ipcMain.handle('set-discord-activity', async (_event, data) => {
  const { title, chapter, type } = data || {};
  const details = title ? `Reading ${title}` : 'Browsing Library';
  const state = chapter ? `Chapter ${chapter} (${type || 'Manga'})` : 'Catalog Explorer';
  updateDiscordPresence(details, state);
  return { ok: true };
});

ipcMain.handle('clear-discord-activity', async () => {
  updateDiscordPresence('Browsing Library', 'Idle');
  return { ok: true };
});

let mainWindow;
let serverProcess;
const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${PORT}`;

function startServer() {
  writeLog('Starting Graywood Reader backend server...');
  const bundled = path.join(__dirname, 'dist-server', 'server.cjs');
  if (fs.existsSync(bundled)) {
    writeLog('Using compiled server at dist-server/server.cjs');
    serverProcess = spawn('node', [bundled], { cwd: __dirname, shell: true, env: { ...process.env, PORT: String(PORT) } });
  } else {
    writeLog('Compiled server not found; falling back to npx tsx server.ts');
    serverProcess = spawn('npx', ['tsx', 'server.ts'], { cwd: __dirname, shell: true, env: { ...process.env, PORT: String(PORT) } });
  }
  serverProcess.stdout.on('data', (d) => writeLog(`[Server]: ${d.toString().trim()}`));
  serverProcess.stderr.on('data', (d) => writeLog(`[Server Error]: ${d.toString().trim()}`));
  serverProcess.on('close', (code) => writeLog(`Server process exited with code ${code}`));
}

function waitForServer(maxMs = 60000, intervalMs = 400) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`${SERVER_URL}/api/health`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          writeLog(`Backend healthy (HTTP ${res.statusCode}) after ${Date.now() - started}ms`);
          resolve();
        } else retry();
      });
      req.on('error', () => retry());
      req.setTimeout(2000, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - started > maxMs) return reject(new Error(`Server not ready within ${maxMs}ms`));
      setTimeout(attempt, intervalMs);
    };
    attempt();
  });
}

function createWindow() {
  writeLog('Creating Electron desktop window...');
  mainWindow = new BrowserWindow({
    width: 1360, height: 900, minWidth: 800, minHeight: 600,
    title: 'Graywood Reader', backgroundColor: '#020617', autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });
  waitForServer()
    .then(() => { writeLog(`Loading desktop app at ${SERVER_URL}`); return mainWindow.loadURL(SERVER_URL); })
    .catch((err) => { writeLog(`Health wait failed: ${err.message}; loading URL anyway`); return mainWindow.loadURL(SERVER_URL); })
    .catch((err) => {
      writeLog(`Failed to load ${SERVER_URL}: ${err.message}`);
      setTimeout(() => { if (mainWindow) mainWindow.loadURL(SERVER_URL); }, 2000);
    });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  // Retry if the backend wasn't ready yet / a transient load failure occurred.
  mainWindow.webContents.on('did-fail-load', (_event, code, desc) => {
    writeLog(`did-fail-load (${code}): ${desc}; retrying in 2s`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(SERVER_URL).catch(() => writeLog('loadURL retry failed'));
      }
    }, 2000);
  });

  mainWindow.on('closed', () => { mainWindow = null; writeLog('Electron window closed'); });
}

app.whenReady().then(() => {
  writeLog('Electron app ready');
  startServer();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => {
  // Keep the backend running on macOS so the app relaunches instantly; on other
  // platforms quit, which triggers the will-quit teardown of the server.
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => {
  writeLog('Electron app quitting');
  if (serverProcess && serverProcess.pid) {
    if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        execSync(`taskkill /pid ${serverProcess.pid} /T /F`, { stdio: 'ignore' });
      } catch (_) {
        try { serverProcess.kill(); } catch (_) {}
      }
    } else {
      try { serverProcess.kill('SIGTERM'); } catch (_) {}
    }
  }
});
