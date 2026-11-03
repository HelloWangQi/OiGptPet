const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petDesktop', Object.freeze({
  getChatSettings: () => ipcRenderer.invoke('chat:get'),
  getChatSnapshot: () => ipcRenderer.invoke('chat:snapshot'),
  getChatState: () => ipcRenderer.invoke('chat:state-get'),
  saveChatSettings: value => ipcRenderer.invoke('chat:save', value),
  sendChat: (text, requestId) => ipcRenderer.invoke('chat:send', text, requestId),
  cancelChat: () => ipcRenderer.invoke('chat:cancel'),
  clearChat: () => ipcRenderer.invoke('chat:clear'),
  onChatState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('chat:state', listener);
    return () => ipcRenderer.removeListener('chat:state', listener);
  },
  saveDiagnostics: () => ipcRenderer.invoke('diagnostics:save'),
  getModel: () => ipcRenderer.invoke('model:get'),
  setModel: (bytes) => ipcRenderer.invoke('model:set', bytes),
  openPet: () => ipcRenderer.invoke('pet:open'),
  openWorkshop: () => ipcRenderer.invoke('workshop:open'),
  hidePet: () => ipcRenderer.invoke('pet:hide'),
  startDrag: () => ipcRenderer.invoke('pet:drag-start'),
  endDrag: () => ipcRenderer.invoke('pet:drag-end'),
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
  saveCharacterPackage: (bytes, sha256, operationId) => ipcRenderer.invoke('character-package:save', bytes, sha256, operationId),
  cancelCharacterPackage: (operationId) => ipcRenderer.invoke('character-package:cancel', operationId),
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
