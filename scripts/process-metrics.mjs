export function labelProcessRoles(processes, windows) {
  return processes.map(process => ({ ...process, roles: [...new Set(windows.filter(win => Number.isInteger(win.pid) && win.pid > 0 && win.pid === process.pid).map(win => win.role))].sort() }));
}

export async function readProcessMetrics(desktop) {
  const value = await desktop.evaluate(({ app, BrowserWindow }) => ({
    windows: BrowserWindow.getAllWindows().map(win => ({ id: win.id, pid: win.webContents.getOSProcessId(), role: win.isResizable() ? 'workshop' : 'pet', visible: win.isVisible() })),
    processes: app.getAppMetrics(), mainMemory: process.memoryUsage(),
  }));
  return { ...value, processes: labelProcessRoles(value.processes, value.windows) };
}
