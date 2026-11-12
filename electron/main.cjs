const { app, BrowserWindow, ipcMain, screen, powerMonitor, Tray, Menu, nativeImage, globalShortcut, dialog, session, protocol, net, safeStorage, desktopCapturer } = require('electron');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const { createWindowRecovery } = require('./window-recovery.cjs');
const { createWindowStateStore } = require('./window-state.cjs');
const { createPetDrag } = require('./pet-drag.cjs');
const { createSelectedDanceStore } = require('./selected-dance.cjs');
const { expandedToolsLayout } = require('./pet-tools-layout.cjs');
const { createPreferencesStore } = require('./preferences.cjs');
const { createCharacterPackageSaver } = require('./character-package-save.cjs');
const { collectDesktopDiagnostics, createDiagnosticsExporter } = require('./desktop-diagnostics.cjs');
const os = require('node:os');
const { createChatService } = require('./chat-service.cjs');
const { assertTrustedSender } = require('./ipc-trust.cjs');
const { createRenderMetricsStore } = require('./render-metrics.cjs');

const root = path.join(__dirname, '..');
protocol.registerSchemesAsPrivileged([{ scheme: 'oipet', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
if (process.env.OIGPTPET_TEST === '1' && process.env.OIGPTPET_TEST_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.OIGPTPET_TEST_USER_DATA));
} else if (!app.isPackaged) app.setPath('userData', path.join(root, '.cache', 'electron-user-data'));
const clientRoot = !app.isPackaged && process.env.OIGPTPET_SMOKE_DEMO === '1' ? path.join(root, '.cache', 'demo-dist') : path.join(root, 'dist');
const usePackagedDefaults = app.isPackaged && (process.env.OIGPTPET_TEST !== '1' || process.env.OIGPTPET_TEST_DEFAULTS === '1');
let workshop;
let pet;
let petToolsLayout;
let tray;
let savedBounds;
let windowRecovery;
let quitting = false;
let quitFlush;
let quitReady = false;
let modelBytes = null;
const renderMetrics = createRenderMetricsStore();
const chat = createChatService({ file: path.join(app.getPath('userData'), 'chat-settings.json'), fs, safeStorage,
  fetch: (...args) => fetch(...args), onState: state => {
    for (const win of [workshop, pet]) if (win && !win.isDestroyed()) {
      try { win.webContents.send('chat:state', state); } catch { /* A closing view must not prevent delivery to the other window. */ }
    }
  } });
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');
const selectedDance = createSelectedDanceStore(path.join(app.getPath('userData'), 'selected-dance.vrma'));
const windowState = createWindowStateStore(statePath(), { onError: error => console.error('Window position could not be saved:', error.message) });
const modelPath = () => path.join(app.getPath('userData'), 'current.vrm');
const preferences = createPreferencesStore(path.join(app.getPath('userData'), 'preferences.json'));
const petDrag = createPetDrag({ getWindow: () => pet, getCursor: () => screen.getCursorScreenPoint() });
function endPetDrag() {
  petDrag.stop();
  windowRecovery?.reconcile();
  persistBounds();
}
const characterPackageSaver = createCharacterPackageSaver({ chooseFile: (owner) => dialog.showSaveDialog(owner, {
  defaultPath: 'OiGptPet-character.oipet', filters: [{ name: 'OiGptPet 角色备份', extensions: ['oipet'] }],
}) });

function trusted(event) {
  return assertTrustedSender(event, [workshop, pet], sender => BrowserWindow.fromWebContents(sender));
}

function secureWindow(options) {
  const win = new BrowserWindow({
    ...options,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  const contentId = win.webContents.id;
  const clearRenderMetrics = () => renderMetrics.clear(contentId);
  win.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) clearRenderMetrics(); });
  win.webContents.on('render-process-gone', clearRenderMetrics);
  win.webContents.on('destroyed', clearRenderMetrics);
  const reportVisibility = () => {
    clearRenderMetrics();
    if (!win.webContents.isDestroyed()) win.webContents.send('window:visibility', win.isVisible());
  };
  win.on('hide', reportVisibility); win.on('show', reportVisibility);
  return win;
}

function isTrustedUiUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'oipet:' && url.hostname === 'app')
      || (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '5173');
  } catch { return false; }
}

function isActiveVoiceWindow(wc, requestingUrl) {
  return [workshop, pet].some(win => win && !win.isDestroyed() && win.isVisible() && win.webContents === wc
    && isTrustedUiUrl(wc.getURL()) && isTrustedUiUrl(requestingUrl ?? wc.getURL()));
}

function isActivePetWindow(wc, requestingUrl) {
  return Boolean(pet && !pet.isDestroyed() && pet.isVisible() && !pet.isMinimized() && pet.webContents === wc
    && isTrustedUiUrl(wc.getURL()) && isTrustedUiUrl(requestingUrl ?? wc.getURL()));
}

function isVisibleTrustedPetFrame(frame) {
  if (!frame || !pet || pet.isDestroyed() || !pet.isVisible() || pet.isMinimized()) return false;
  try { return pet.webContents.mainFrame === frame && isTrustedUiUrl(frame.url); }
  catch { return false; }
}

async function loadView(win, mode) {
  if (process.env.OIGPTPET_DEV_URL === 'http://127.0.0.1:5173') await win.loadURL(`${process.env.OIGPTPET_DEV_URL}/?mode=${mode}`);
  else await win.loadURL(`oipet://app/index.html?mode=${mode}`);
}

function openWorkshop() {
  if (workshop && !workshop.isDestroyed()) { workshop.show(); workshop.focus(); return; }
  workshop = secureWindow({ width: 1220, height: 850, minWidth: 980, minHeight: 700, backgroundColor: '#f5f4f0', title: 'OiGptPet · 角色工坊', autoHideMenuBar: true });
  workshop.on('closed', () => { chat.cancel(); workshop = null; });
  workshop.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) chat.cancel(); });
  loadView(workshop, 'workshop').catch(console.error);
}

function currentBounds() {
  return windowRecovery.boundsFor(savedBounds);
}

function setPetToolsOpen(open) {
  if (!pet || pet.isDestroyed()) return;
  const current = pet.getBounds();
  const base = petToolsLayout
    ? { ...current, x: current.x + petToolsLayout.petLeft, width: petToolsLayout.petWidth }
    : current;
  const next = open ? expandedToolsLayout(base, screen.getDisplayMatching(base).workArea)
    : { bounds: base, layout: { open: false, petWidth: base.width, petLeft: 0, toolsLeft: 0, toolsWidth: 288 } };
  petToolsLayout = open ? next.layout : undefined;
  pet.setBounds(next.bounds);
  pet.setIgnoreMouseEvents(false);
  pet.webContents.send('pet:tools-layout', next.layout);
  persistBounds();
  return next.layout;
}

async function updatePreferences(patch) {
  const next = await preferences.update(patch);
  if (pet && !pet.isDestroyed()) {
    windowRecovery.reconcile();
  }
  for (const win of [workshop, pet]) if (win && !win.isDestroyed()) win.webContents.send('preferences:changed', next);
  return next;
}

function openPet() {
  if (pet && !pet.isDestroyed()) { windowRecovery.reconcile(); pet.setIgnoreMouseEvents(false); pet.show(); return; }
  pet = secureWindow({ ...currentBounds(), transparent: true, frame: false, hasShadow: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#00000000', title: 'OiGptPet' });
  pet.on('move', persistBounds);
  pet.on('resize', persistBounds);
  pet.on('blur', endPetDrag);
  pet.on('hide', endPetDrag);
  pet.on('closed', () => petDrag.stop(false));
  pet.on('close', persistBounds);
  pet.on('closed', () => { pet = null; petToolsLayout = undefined; });
  persistBounds();
  loadView(pet, 'pet').catch(console.error);
}

function persistBounds() {
  if (quitting || !pet || pet.isDestroyed()) return;
  savedBounds = pet.getBounds();
  if (petToolsLayout) savedBounds = { ...savedBounds, x: savedBounds.x + petToolsLayout.petLeft, width: petToolsLayout.petWidth };
  windowState.schedule(savedBounds);
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
  ipcMain.handle('window:visibility-get', event => trusted(event).isVisible());
  ipcMain.handle('render:metrics', (event, value) => { const owner = trusted(event); renderMetrics.update(owner.webContents.id, value); });
  const chatOwner = event => { if (trusted(event) !== workshop) throw new Error('Only the workshop can control chat'); };
  const petChatOwner = event => {
    const owner = trusted(event);
    if (owner !== pet || !owner.isVisible() || !isTrustedUiUrl(owner.webContents.getURL())) throw new Error('Only the visible pet can send a pet message');
  };
  ipcMain.handle('chat:get', event => { chatOwner(event); return chat.get(); });
  ipcMain.handle('chat:check', event => { chatOwner(event); return chat.check(); });
  ipcMain.handle('chat:snapshot', event => { chatOwner(event); return chat.snapshot(); });
  ipcMain.handle('chat:state-get', event => { trusted(event); return chat.getState(); });
  ipcMain.handle('chat:save', (event, value) => { chatOwner(event); return chat.save(value); });
  ipcMain.handle('chat:send', (event, text, requestId) => { chatOwner(event); return chat.send(text, requestId); });
  ipcMain.handle('chat:send-pet', (event, text, requestId) => { petChatOwner(event); return chat.send(text, requestId); });
  ipcMain.handle('chat:cancel', event => {
    const owner = trusted(event);
    if (owner !== workshop) petChatOwner(event);
    chat.cancel();
  });
  ipcMain.handle('chat:clear', event => { chatOwner(event); chat.clear(); });
  const saveDiagnostics = createDiagnosticsExporter({
    chooseFile: owner => dialog.showSaveDialog(owner, { defaultPath: 'OiGptPet-desktop-diagnostics.json', filters: [{ name: '桌面诊断 JSON', extensions: ['json'] }] }),
    collect: () => collectDesktopDiagnostics({ app, screen, os, versions: process.versions, preferences: preferences.get(), windows: { workshop, pet },
      renderMetrics: win => win.isVisible() ? renderMetrics.read(win.webContents.id) : { status: 'hidden', sample: null } }),
    writeFile: fs.writeFile,
  });
  ipcMain.handle('diagnostics:save', event => {
    const owner = trusted(event);
    if (owner !== workshop) throw new Error('Only the workshop can export diagnostics');
    return saveDiagnostics(owner);
  });
  ipcMain.handle('pet:drag-start', (event, pointer) => {
    if (trusted(event) !== pet) throw new Error('Only the pet can start dragging');
    if (petToolsLayout) setPetToolsOpen(false);
    return !quitting && petDrag.start(pointer);
  });
  ipcMain.handle('pet:drag-end', event => {
    if (trusted(event) !== pet) throw new Error('Only the pet can end dragging');
    endPetDrag();
  });
  ipcMain.handle('character-package:save', (event, bytes, sha256, operationId) => characterPackageSaver.save(trusted(event), bytes, sha256, operationId));
  ipcMain.handle('character-package:cancel', (event, operationId) => characterPackageSaver.cancel(trusted(event), operationId));
  ipcMain.handle('model:get', (event) => { trusted(event); return modelBytes; });
  ipcMain.handle('defaults:get', async (event, kind) => {
    trusted(event);
    if (!['model', 'dance'].includes(kind)) throw new Error('Invalid default asset');
    if (!usePackagedDefaults) return null;
    const name = kind === 'model' ? 'BREAK VENOM.vrm' : '不是恶魔.vrma';
    const bytes = await fs.readFile(path.join(root, 'defaults', name));
    if (bytes.length === 0 || bytes.length > 64 * 1024 * 1024) throw new Error('默认素材大小无效。');
    return bytes;
  });
  ipcMain.handle('dance:get', event => { trusted(event); return selectedDance.get(); });
  ipcMain.handle('dance:set', async (event, bytes) => {
    trusted(event);
    await selectedDance.set(bytes);
    for (const win of [workshop, pet]) if (win && !win.isDestroyed() && win.webContents !== event.sender) win.webContents.send('dance:changed');
  });
  ipcMain.handle('dance:clear', async event => {
    trusted(event);
    await selectedDance.clear();
    for (const win of [workshop, pet]) if (win && !win.isDestroyed() && win.webContents !== event.sender) win.webContents.send('dance:changed');
  });
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
  ipcMain.handle('pet:quit', (event) => {
    if (trusted(event) !== pet) throw new Error('Only the pet can request application exit');
    app.quit();
  });
  ipcMain.handle('pet:click-through', (event, enabled) => {
    trusted(event);
    if (typeof enabled !== 'boolean') throw new Error('Invalid toggle');
    pet?.setIgnoreMouseEvents(petDrag.active ? false : enabled, { forward: true });
  });
  ipcMain.handle('pet:tools-open', (event, open) => {
    if (trusted(event) !== pet) throw new Error('Only the pet can open its tools');
    if (typeof open !== 'boolean') throw new Error('Invalid tools toggle');
    return setPetToolsOpen(open);
  });
  ipcMain.handle('preferences:get', (event) => { trusted(event); return preferences.get(); });
  ipcMain.handle('preferences:set', async (event, patch) => { trusted(event); return updatePreferences(patch); });
  ipcMain.handle('pet:scale', async (event, scale) => {
    trusted(event);
    if (![0.8, 1, 1.2].includes(scale)) throw new Error('Invalid size');
    await updatePreferences({ scale });
  });
  ipcMain.handle('atlas:save', async (event, bytes, profile, sha256) => {
    const owner = trusted(event);
    if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes.length > 20 * 1024 * 1024 || !['v1', 'v2'].includes(profile)) throw new Error('Invalid atlas');
    const png = Buffer.from(bytes);
    if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) || createHash('sha256').update(png).digest('hex') !== sha256) throw new Error('Atlas hash mismatch');
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.readUInt32BE(16) !== 1536 || png.readUInt32BE(20) !== (profile === 'v2' ? 2288 : 1872)) throw new Error('Invalid PNG dimensions');
    const result = await dialog.showSaveDialog(owner, { defaultPath: `OiGptPet-${profile}.png`, filters: [{ name: 'PNG 图集', extensions: ['png'] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, png);
    return result.filePath;
  });
  ipcMain.handle('report:save', async (event, json) => {
    const owner = trusted(event);
    if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > 1024 * 1024) throw new Error('Invalid report size');
    let report;
    try { report = JSON.parse(json); } catch { throw new Error('Invalid report JSON'); }
    if (report.schemaVersion !== 1 || report.application !== 'OiGptPet' || !/^[a-f0-9]{64}$/.test(report.file?.sha256 ?? '') || !['v1', 'v2'].includes(report.file?.profile) || !Number.isSafeInteger(report.file?.encodedBytes)) throw new Error('Invalid report schema');
    const result = await dialog.showSaveDialog(owner, { defaultPath: `OiGptPet-${report.file.profile}-report.json`, filters: [{ name: 'JSON 检查报告', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, json, 'utf8');
    return result.filePath;
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (usePackagedDefaults && windowRecovery) recoverPet(); else openWorkshop(); });
  app.whenReady().then(async () => {
    protocol.handle('oipet', (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'app' || !['GET', 'HEAD'].includes(request.method)) return new Response('Forbidden', { status: 403 });
        const base = clientRoot;
        const target = path.resolve(base, `.${decodeURIComponent(url.pathname)}`);
        const relative = path.relative(base, target);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Forbidden', { status: 403 });
        return net.fetch(pathToFileURL(target).toString());
      } catch { return new Response('Invalid resource', { status: 400 }); }
    });
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    windowRecovery = createWindowRecovery({ screen, powerMonitor, getWindow: () => {
      if (petToolsLayout) setPetToolsOpen(false);
      return pet;
    }, getScale: () => preferences.get().scale });
    try { await preferences.load(); } catch (error) { console.error('Preferences could not be read:', error.message); }
    try { await chat.load(); } catch { console.warn('Chat settings could not be loaded; save them again in the workshop.'); }
    try { savedBounds = await windowState.load(); } catch (error) { console.error('Window position could not be read:', error.message); }
    try { const bytes = await fs.readFile(modelPath()); if (bytes.length <= 64 * 1024 * 1024) modelBytes = bytes; } catch { /* No imported model yet. */ }
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      const mediaTypes = details?.mediaTypes ?? [];
      const microphoneOnly = mediaTypes.includes('audio') && !mediaTypes.includes('video');
      const systemMusicCapture = permission === 'display-capture' && mediaTypes.includes('audio') && mediaTypes.includes('video');
      callback(Boolean(permission === 'media' && microphoneOnly && isActiveVoiceWindow(wc, details?.requestingUrl)
        || systemMusicCapture && isActivePetWindow(wc, details?.requestingUrl)));
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => {
      if (permission === 'display-capture') return isActivePetWindow(wc, origin);
      return permission === 'media' && isActiveVoiceWindow(wc, origin);
    });
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      const frame = request.frame?.top;
      if (!isVisibleTrustedPetFrame(frame) || !request.userGesture || !request.audioRequested || !request.videoRequested) {
        callback(null);
        return;
      }
      void desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then(sources => {
        if (!isVisibleTrustedPetFrame(frame) || !sources.length) { callback(null); return; }
        callback({ video: sources[0], audio: 'loopback' });
      }).catch(() => callback(null));
    });
    handlers();
    tray = new Tray(makeTrayIcon());
    tray.setToolTip('OiGptPet · Ctrl+Alt+P 恢复互动');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开角色工坊', click: openWorkshop },
      { label: '显示桌宠 / 恢复互动', click: recoverPet },
      { label: '隐藏桌宠', click: () => pet?.hide() },
      { type: 'separator' }, { label: '退出 OiGptPet', click: () => app.quit() },
    ]));
    tray.on('double-click', openWorkshop);
    const registered = globalShortcut.register('CommandOrControl+Alt+P', recoverPet);
    if (!registered) console.warn('Ctrl+Alt+P unavailable; restore interactivity from the tray menu.');
    if (usePackagedDefaults) openPet(); else openWorkshop();
  }).catch((error) => { console.error(error); app.exit(1); });
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
  app.on('before-quit', event => {
    if (quitReady) return;
    event.preventDefault();
    if (quitFlush) return;
    chat.clear();
    petDrag.stop();
    // Capture the live bounds before freezing move/resize persistence during shutdown.
    persistBounds();
    quitting = true;
    windowRecovery?.dispose();
    quitFlush = windowState.flush()
      .catch(error => console.error('Last window position could not be saved:', error.message))
      .finally(() => { quitReady = true; app.quit(); });
  });
  app.on('will-quit', () => { windowRecovery?.dispose(); globalShortcut.unregisterAll(); });
}
