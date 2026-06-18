import { app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import started from 'electron-squirrel-startup';
import { startOperatorPoller } from './operator-executor';

if (started) app.quit();

// ─── Config ────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'jarvis-config.json');

function loadConfig(): { pinHash: string | null } {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); }
  catch { return { pinHash: null }; }
}

function saveConfig(cfg: { pinHash: string | null }) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function hashPin(pin: string): string {
  return crypto.createHash('sha256').update('jarvis-salt-' + pin).digest('hex');
}

// ─── Allowed paths for file access ─────────────────────────────────────────
const ALLOWED_PATHS = [
  'C:\\Users\\user\\Documents\\Obsidian Vault',
  'C:\\Users\\user\\trading-stack',
  path.join('C:\\Users\\user\\Claude apps'),
  app.getPath('userData'),
];

function isPathAllowed(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  return ALLOWED_PATHS.some(allowed => normalized.startsWith(path.normalize(allowed)));
}

// ─── Window state ───────────────────────────────────────────────────────────
let win: BrowserWindow;
let appWin: BrowserWindow | null = null;

// Minimal Mac-style pill (Dynamic Island feel), centered at the top of the screen.
const PILL_SIZE = { width: 200, height: 40 };
const FRONTEND_URL = 'http://127.0.0.1:3020'; // the polished UI, shown in the app window
// Daemon (the brain + guidance queue) is localhost :9101 — see daemonRequest().

// Horizontally centered, near the top edge of the work area.
function topCenter(w: number): { x: number; y: number } {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: Math.round(wa.x + (wa.width - w) / 2), y: wa.y + 8 };
}

function setPill(): void {
  if (!win || win.isDestroyed()) return;
  const { x, y } = topCenter(PILL_SIZE.width);
  win.setResizable(true);
  win.setSize(PILL_SIZE.width, PILL_SIZE.height, true);
  win.setPosition(x, y, true);
  win.setResizable(false);
}

// The full app window — loads the polished frontend (:3020) with all options.
function showApp(): void {
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 400;   // small, lightweight quick-chat window — easy on RAM
  const H = 560;
  const x = Math.round(wa.x + (wa.width - W) / 2);
  const y = wa.y + 54; // drops down just below the pill
  if (!appWin || appWin.isDestroyed()) {
    appWin = new BrowserWindow({
      width: W, height: H, x, y,
      frame: false,
      backgroundColor: '#02060f',
      resizable: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    appWin.loadURL(FRONTEND_URL + "/quick.html"); // lightweight talk box (not the heavy full app)
    // X / close just hides it, so reopening is instant
    appWin.on('close', (e) => { e.preventDefault(); appWin?.hide(); });
    // Esc hides the window when it's focused
    appWin.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') appWin?.hide();
    });
    appWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  }
  appWin.setBounds({ x, y, width: W, height: H });
  appWin.show();
  appWin.focus();
}

function hideApp(): void {
  if (appWin && !appWin.isDestroyed()) appWin.hide();
}

// The FULL app — the heavy, polished frontend (:3020) with advisors, agents, everything.
let fullWin: BrowserWindow | null = null;
function showFull(): void {
  const wa = screen.getPrimaryDisplay().workArea;
  const W = Math.min(1180, wa.width - 60);
  const H = Math.min(800, wa.height - 70);
  const x = Math.round(wa.x + (wa.width - W) / 2);
  const y = wa.y + 54;
  if (!fullWin || fullWin.isDestroyed()) {
    fullWin = new BrowserWindow({
      width: W, height: H, x, y,
      frame: false,
      backgroundColor: '#02060f',
      resizable: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    fullWin.loadURL(FRONTEND_URL);
    fullWin.on('close', (e) => { e.preventDefault(); fullWin?.hide(); });
    fullWin.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') fullWin?.hide();
    });
    fullWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  }
  fullWin.setBounds({ x, y, width: W, height: H });
  fullWin.show();
  fullWin.focus();
}
function hideFull(): void {
  if (fullWin && !fullWin.isDestroyed()) fullWin.hide();
}
function toggleFull(): void {
  if (fullWin && !fullWin.isDestroyed() && fullWin.isVisible()) fullWin.hide();
  else showFull();
}

// ─── Window factory ─────────────────────────────────────────────────────────
function createWindow() {
  const { x, y } = topCenter(PILL_SIZE.width);

  win = new BrowserWindow({
    width: PILL_SIZE.width,
    height: PILL_SIZE.height,
    x, y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,          // fixed at the top-center, like the Mac notch
    roundedCorners: false,
    hasShadow: false,        // we draw our own soft shadow on the pill
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Alt+J → open/close the FULL app (advisors, agents, everything)
  globalShortcut.register('Alt+J', () => { toggleFull(); });

  // Ctrl+Alt+Space → open the orb (full app). Quick-chat box retired: orb + Slack only.
  globalShortcut.register('Control+Alt+Space', () => { showFull(); });

  // Hide / show everything on command — frees the top of the screen (e.g. Chrome tabs)
  globalShortcut.register('Control+Alt+J', () => {
    if (win.isVisible()) { win.hide(); hideApp(); hideFull(); }
    else { win.show(); }
  });

  // Grant microphone for the "Hey Jarvis" wake word
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'audioCapture');
  });

  // Open external links in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────

// Window mode — expand into a top-center panel that drops down from the pill,
// or collapse back to the minimal pill.
ipcMain.on('pin-screen-open', () => showFull());
ipcMain.on('pin-screen-close', () => hideApp());
ipcMain.on('expand-sidebar', () => showFull());
ipcMain.on('collapse-bubble', () => hideApp());

// Auth
ipcMain.handle('auth:get-status', () => {
  const cfg = loadConfig();
  return { hasPinSet: !!cfg.pinHash };
});

ipcMain.handle('auth:verify-pin', (_, pin: string) => {
  const cfg = loadConfig();
  if (!cfg.pinHash) return { success: true, isFirstTime: true };
  return { success: hashPin(pin) === cfg.pinHash };
});

ipcMain.handle('auth:set-pin', (_, pin: string) => {
  if (!/^\d{4}$/.test(pin)) return { success: false, error: 'PIN must be 4 digits' };
  saveConfig({ pinHash: hashPin(pin) });
  return { success: true };
});

// Screen capture
ipcMain.handle('screen:capture', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    if (!sources.length) return { success: false, error: 'No screen sources' };
    return { success: true, dataUrl: sources[0].thumbnail.toDataURL() };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});

// File system
ipcMain.handle('fs:read', (_, filePath: string) => {
  if (!isPathAllowed(filePath)) return { success: false, error: 'Access denied' };
  try {
    return { success: true, content: fs.readFileSync(filePath, 'utf-8') };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});

ipcMain.handle('fs:write', (_, filePath: string, content: string) => {
  if (!isPathAllowed(filePath)) return { success: false, error: 'Access denied' };
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});

ipcMain.handle('fs:append', (_, filePath: string, content: string) => {
  if (!isPathAllowed(filePath)) return { success: false, error: 'Access denied' };
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});

ipcMain.handle('fs:list', (_, dirPath: string) => {
  if (!isPathAllowed(dirPath)) return { success: false, error: 'Access denied' };
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    return {
      success: true,
      items: items.map(i => ({ name: i.name, isDir: i.isDirectory() })),
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});

// Shell execution — strict allowlist
const ALLOWED_EXECUTABLES = ['python', 'python3', 'node', 'npm', 'npx', 'pip'];

ipcMain.handle('exec:run', (_, executable: string, args: string[]) => {
  if (!ALLOWED_EXECUTABLES.includes(path.basename(executable).replace('.exe', ''))) {
    return { success: false, error: 'Executable not on allowlist' };
  }
  return new Promise(resolve => {
    execFile(executable, args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) resolve({ success: false, error: stderr || String(err) });
      else resolve({ success: true, output: stdout });
    });
  });
});

// ─── Screen-annotation overlay ─────────────────────────────────────────────
// A transparent, click-through, full-screen window that draws whatever JARVIS
// puts on /api/annotate (highlights, arrows, "look here"). Invisible until used.
let annotateWin: BrowserWindow | null = null;
function ensureAnnotateWindow(): void {
  if (annotateWin && !annotateWin.isDestroyed()) return;
  const b = screen.getPrimaryDisplay().bounds;
  annotateWin = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, focusable: false, hasShadow: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  annotateWin.setAlwaysOnTop(true, 'screen-saver');
  annotateWin.setIgnoreMouseEvents(true);   // click-through — never blocks the user
  annotateWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  annotateWin.loadURL(FRONTEND_URL + '/annotate.html');
  annotateWin.on('closed', () => { annotateWin = null; });
}

// ─── Screen-guidance poller ────────────────────────────────────────────────
// The orb asks the daemon "guide me to do X" but the browser can't screenshot the
// whole OS — we can. We poll the daemon's queue, grab a screenshot when there's a
// request, and post it back so the daemon can locate the target and draw on screen.
async function captureScreenDataUrl(): Promise<string | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 },
    });
    if (!sources.length) return null;
    // JPEG (q72), not PNG — a full-screen PNG is ~870KB; this is ~80KB, so the
    // upload AND the vision model's image-ingest are both far faster. Coordinates
    // are normalised 0..1 fractions, so the slight quality drop doesn't matter.
    const jpeg = sources[0].thumbnail.toJPEG(72);
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    return null;
  }
}

// Talk to the daemon via Node's http module — reliable in the Electron MAIN
// process, where global fetch is inconsistent across Electron versions.
function daemonRequest(method: string, pathname: string, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        host: '127.0.0.1', port: 9101, path: pathname, method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {},
      },
      res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', d => { data += d; });
        res.on('end', () => { try { resolve(data ? JSON.parse(data) : null); } catch { resolve(null); } });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let guidePolling = false;
async function pollGuideOnce(): Promise<void> {
  if (guidePolling) return;
  guidePolling = true;
  try {
    const data = await daemonRequest('GET', '/api/guide/pending') as { pending: { id: string; task: string } | null } | null;
    if (!data || !data.pending) return;

    const screenshot = await captureScreenDataUrl();
    if (!screenshot) { console.error('[guide] screenshot capture failed'); return; }

    // Daemon looks the task up by id from its own queue — we only send the shot.
    await daemonRequest('POST', '/api/guide/capture', { id: data.pending.id, screenshot });
    console.log('[guide] fulfilled', data.pending.task);
  } catch (e) {
    console.error('[guide] poll error:', e instanceof Error ? e.message : String(e));
  } finally {
    guidePolling = false;
  }
}

let guideTimer: ReturnType<typeof setInterval> | null = null;
function startGuidePoller(): void {
  if (guideTimer) return;
  console.log('[guide] poller started — watching daemon for guidance requests');
  guideTimer = setInterval(() => { void pollGuideOnce(); }, 800);
}

// ─── App lifecycle ─────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow(); ensureAnnotateWindow(); startGuidePoller();
  // Computer-use "hands" — only activates if the native input lib is installed.
  void startOperatorPoller(daemonRequest, captureScreenDataUrl);
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (guideTimer) { clearInterval(guideTimer); guideTimer = null; }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
