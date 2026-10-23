const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petDesktop', Object.freeze({
  getModel: () => ipcRenderer.invoke('model:get'),
  setModel: (bytes) => ipcRenderer.invoke('model:set', bytes),
  openPet: () => ipcRenderer.invoke('pet:open'),
  openWorkshop: () => ipcRenderer.invoke('workshop:open'),
  hidePet: () => ipcRenderer.invoke('pet:hide'),
  setClickThrough: (value) => ipcRenderer.invoke('pet:click-through', value),
  setScale: (value) => ipcRenderer.invoke('pet:scale', value),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  setPreferences: (patch) => ipcRenderer.invoke('preferences:set', patch),
  onPreferencesChanged: (callback) => {
    const listener = (_event, preferences) => callback(preferences);
    ipcRenderer.on('preferences:changed', listener);
    return () => ipcRenderer.removeListener('preferences:changed', listener);
  },
  saveAtlas: (bytes, profile, sha256) => ipcRenderer.invoke('atlas:save', bytes, profile, sha256),
  saveReport: (json) => ipcRenderer.invoke('report:save', json),
  onInteractionRestored: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('pet:interactive', listener);
    return () => ipcRenderer.removeListener('pet:interactive', listener);
  },
  onModelChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('model:changed', listener);
    return () => ipcRenderer.removeListener('model:changed', listener);
  },
}));
