const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFilePath = path.join(logsDir, 'desktop_app.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

function writeLog(msg) {
  const timestamp = new Date().toISOString();
  const formatted = `[${timestamp}] ${msg}\n`;
  console.log(msg);
  logStream.write(formatted);
}

let mainWindow;
let serverProcess;

const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${PORT}`;

function startServer() {
  writeLog('Starting OmniManga Kotatsu backend server...');
  serverProcess = spawn('npx', ['tsx', 'server.ts'], {
    cwd: __dirname,
    shell: true,
    env: { ...process.env, PORT: PORT.toString() },
  });

  serverProcess.stdout.on('data', (data) => {
    writeLog(`[Server]: ${data.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    writeLog(`[Server Error]: ${data.toString().trim()}`);
  });

  serverProcess.on('close', (code) => {
    writeLog(`Server process exited with code ${code}`);
  });
}

function createWindow() {
  writeLog('Creating Electron desktop window...');
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'OmniManga Sync & Kotatsu Reader',
    backgroundColor: '#090d16',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // webSecurity stays enabled (default) — all content is served same-origin
      // from the local server, and remote images go through the server-side proxy.
    },
  });

  setTimeout(() => {
    writeLog(`Loading desktop app at ${SERVER_URL}`);
    mainWindow.loadURL(SERVER_URL).catch((err) => {
      writeLog(`Failed to load ${SERVER_URL}: ${err.message}`);
      setTimeout(() => mainWindow.loadURL(SERVER_URL), 2000);
    });
  }, 1500);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    writeLog('Electron window closed');
  });
}

app.whenReady().then(() => {
  writeLog('Electron app ready');
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  writeLog('Electron app quitting');
  if (serverProcess) {
    serverProcess.kill();
  }
});
