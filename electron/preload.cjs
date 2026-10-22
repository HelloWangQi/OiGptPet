const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petDesktop', Object.freeze({
  getModel: () => ipcRenderer.invoke('model:get'),
  setModel: (bytes) => ipcRenderer.invoke('model:set', bytes),
  openPet: () => ipcRenderer.invoke('pet:open'),
  openWorkshop: () => ipcRenderer.invoke('workshop:open'),
  hidePet: () => ipcRenderer.invoke('pet:hide'),
  setClickThrough: (value) => ipcRenderer.invoke('pet:click-through', value),
  setScale: (value) => ipcRenderer.invoke('pet:scale', value),
  saveAtlas: (bytes, profile) => ipcRenderer.invoke('atlas:save', bytes, profile),
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
