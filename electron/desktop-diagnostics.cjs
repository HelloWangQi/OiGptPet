const rect = value => ({ x: value.x, y: value.y, width: value.width, height: value.height });

// Select fields explicitly: never serialize Electron objects, paths or assets.
function collectDesktopDiagnostics({ app, screen, os, versions, preferences, windows, renderMetrics = () => ({ status: 'not-sampled', sample: null }), now = () => new Date() }) {
  const primary = screen.getPrimaryDisplay().id;
  return {
    format: 'oigptpet-desktop-diagnostics', version: 1,
    capturedAt: now().toISOString(), coordinateUnit: 'DIP', memoryUnit: 'KiB',
    application: { version: app.getVersion(), packaged: app.isPackaged, electron: versions.electron, chrome: versions.chrome },
    system: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model ?? null, totalMemoryBytes: os.totalmem() },
    preferences: { scale: preferences.scale, performance: preferences.performance },
    displays: screen.getAllDisplays().map(d => ({ id: d.id, primary: d.id === primary, bounds: rect(d.bounds), workArea: rect(d.workArea), scaleFactor: d.scaleFactor, rotation: d.rotation })),
    windows: Object.entries(windows).map(([role, win]) => {
      if (!win || win.isDestroyed()) return { role, exists: false };
      const bounds = win.getBounds();
      return { role, exists: true, bounds: rect(bounds), visible: win.isVisible(), focused: win.isFocused(), displayId: screen.getDisplayMatching(bounds).id, rendering: renderMetrics(win) };
    }),
    processes: app.getAppMetrics().map(p => ({ type: p.type, cpuPercent: p.cpu?.percentCPUUsage ?? null,
      privateKiB: p.memory?.privateBytes ?? null, workingSetKiB: p.memory?.workingSetSize ?? null })),
  };
}

function createDiagnosticsExporter({ chooseFile, collect, writeFile }) {
  let busy = false;
  return async owner => {
    if (busy) throw new Error('A diagnostic export is already open');
    busy = true;
    try {
      const result = await chooseFile(owner);
      if (result.canceled || !result.filePath || owner.isDestroyed()) return false;
      // Capture after the dialog closes, so this is the state at save time.
      await writeFile(result.filePath, JSON.stringify(collect(), null, 2) + '\n', 'utf8');
      return true;
    } finally { busy = false; }
  };
}
module.exports = { collectDesktopDiagnostics, createDiagnosticsExporter };
