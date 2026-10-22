const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, dialog, session, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const { fitBounds } = require('./geometry.cjs');

const root = path.join(__dirname, '..');
protocol.registerSchemesAsPrivileged([{ scheme: 'oipet', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
if (!app.isPackaged) app.setPath('userData', path.join(root, '.cache', 'electron-user-data'));
let workshop;
let pet;
let tray;
let savedBounds;
let stateTimer;
let quitting = false;
let modelBytes = null;
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');
const modelPath = () => path.join(app.getPath('userData'), 'current.vrm');

function trusted(event) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (![workshop, pet].includes(owner) || event.senderFrame !== event.sender.mainFrame) throw new Error('Unknown IPC sender');
  return owner;
}

function secureWindow(options) {
  const win = new BrowserWindow({
    ...options,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  return win;
}

async function loadView(win, mode) {
  if (process.env.OIGPTPET_DEV_URL === 'http://127.0.0.1:5173') await win.loadURL(`${process.env.OIGPTPET_DEV_URL}/?mode=${mode}`);
  else await win.loadURL(`oipet://app/index.html?mode=${mode}`);
}

function openWorkshop() {
  if (workshop && !workshop.isDestroyed()) { workshop.show(); workshop.focus(); return; }
  workshop = secureWindow({ width: 1220, height: 850, minWidth: 980, minHeight: 700, backgroundColor: '#f5f4f0', title: 'OiGptPet · 角色工坊', autoHideMenuBar: true });
  workshop.on('closed', () => { workshop = null; });
  loadView(workshop, 'workshop').catch(console.error);
}

function currentBounds() {
  let area = screen.getPrimaryDisplay().workArea;
  if (savedBounds && Number.isFinite(savedBounds.x) && Number.isFinite(savedBounds.y)) {
    const target = screen.getDisplayMatching({ x: savedBounds.x, y: savedBounds.y, width: 320, height: 420 });
    area = target.workArea;
  }
  return fitBounds(savedBounds, area, { width: 320, height: 420 });
}

function openPet() {
  if (pet && !pet.isDestroyed()) { pet.setIgnoreMouseEvents(false); pet.show(); return; }
  pet = secureWindow({ ...currentBounds(), transparent: true, frame: false, hasShadow: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#00000000', title: 'OiGptPet' });
  pet.on('move', persistBounds);
  pet.on('resize', persistBounds);
  pet.on('closed', () => { pet = null; });
  loadView(pet, 'pet').catch(console.error);
}

function persistBounds() {
  if (!pet || pet.isDestroyed()) return;
  savedBounds = pet.getBounds();
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => fs.writeFile(statePath(), JSON.stringify(savedBounds)).catch(console.error), 300);
}

function recoverPet() { openPet(); pet.setIgnoreMouseEvents(false); pet.show(); pet.focus(); pet.webContents.send('pet:interactive'); }

function makeTrayIcon() {
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const d = Math.hypot(x - 15.5, y - 15.5);
    if (d < 14 && d > 7) pixels.set([85, 120, 76, 255], (y * 32 + x) * 4);
  }
  return nativeImage.createFromBitmap(pixels, { width: 32, height: 32 });
}

function handlers() {
  ipcMain.handle('model:get', (event) => { trusted(event); return modelBytes; });
  ipcMain.handle('model:set', async (event, bytes) => {
    trusted(event);
    if (!(bytes instanceof Uint8Array) || bytes.length < 28 || bytes.length > 64 * 1024 * 1024 || Buffer.from(bytes.subarray(0, 4)).toString() !== 'glTF') throw new Error('Invalid VRM bytes');
    const next = Buffer.from(bytes);
    await fs.writeFile(`${modelPath()}.tmp`, next);
    await fs.rename(`${modelPath()}.tmp`, modelPath());
    modelBytes = next;
    for (const win of [workshop, pet]) if (win && !win.isDestroyed() && win.webContents !== event.sender) win.webContents.send('model:changed');
    return true;
  });
  ipcMain.handle('pet:open', (event) => { trusted(event); openPet(); });
  ipcMain.handle('workshop:open', (event) => { trusted(event); openWorkshop(); });
  ipcMain.handle('pet:hide', (event) => { trusted(event); pet?.hide(); });
  ipcMain.handle('pet:click-through', (event, enabled) => {
    trusted(event);
    if (typeof enabled !== 'boolean') throw new Error('Invalid toggle');
    pet?.setIgnoreMouseEvents(enabled, { forward: true });
  });
  ipcMain.handle('pet:scale', (event, scale) => {
    trusted(event);
    if (![0.8, 1, 1.2].includes(scale)) throw new Error('Invalid size');
    if (pet) {
      const area = screen.getDisplayMatching(pet.getBounds()).workArea;
      pet.setBounds(fitBounds({ ...pet.getBounds(), width: 320 * scale, height: 420 * scale }, area, { width: 320, height: 420 }));
    }
  });
  ipcMain.handle('atlas:save', async (event, bytes, profile) => {
    const owner = trusted(event);
    if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes.length > 20 * 1024 * 1024 || !['v1', 'v2'].includes(profile)) throw new Error('Invalid atlas');
    const png = Buffer.from(bytes);
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.readUInt32BE(16) !== 1536 || png.readUInt32BE(20) !== (profile === 'v2' ? 2288 : 1872)) throw new Error('Invalid PNG dimensions');
    const result = await dialog.showSaveDialog(owner, { defaultPath: `OiGptPet-${profile}.png`, filters: [{ name: 'PNG 图集', extensions: ['png'] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, png);
    return result.filePath;
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', openWorkshop);
  app.whenReady().then(async () => {
    protocol.handle('oipet', (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'app' || !['GET', 'HEAD'].includes(request.method)) return new Response('Forbidden', { status: 403 });
        const base = path.join(root, 'dist');
        const target = path.resolve(base, `.${decodeURIComponent(url.pathname)}`);
        const relative = path.relative(base, target);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Forbidden', { status: 403 });
        return net.fetch(pathToFileURL(target).toString());
      } catch { return new Response('Invalid resource', { status: 400 }); }
    });
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    try { savedBounds = JSON.parse(await fs.readFile(statePath(), 'utf8')); } catch { /* First launch or damaged settings. */ }
    try { const bytes = await fs.readFile(modelPath()); if (bytes.length <= 64 * 1024 * 1024) modelBytes = bytes; } catch { /* No imported model yet. */ }
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    handlers();
    tray = new Tray(makeTrayIcon());
    tray.setToolTip('OiGptPet · Ctrl+Alt+P 恢复互动');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开角色工坊', click: openWorkshop },
      { label: '显示桌宠 / 恢复互动', click: recoverPet },
      { label: '隐藏桌宠', click: () => pet?.hide() },
      { type: 'separator' }, { label: '退出 OiGptPet', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('double-click', openWorkshop);
    const registered = globalShortcut.register('CommandOrControl+Alt+P', recoverPet);
    if (!registered) console.warn('Ctrl+Alt+P unavailable; restore interactivity from the tray menu.');
    screen.on('display-removed', () => pet && pet.setBounds(currentBounds()));
    screen.on('display-metrics-changed', () => pet && pet.setBounds(currentBounds()));
    openWorkshop();
  }).catch((error) => { console.error(error); app.exit(1); });
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
  app.on('before-quit', () => { quitting = true; clearTimeout(stateTimer); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
