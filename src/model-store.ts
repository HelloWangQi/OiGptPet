async function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('oigptpet', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('models');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getSavedModel(): Promise<ArrayBuffer | null> {
  if (window.petDesktop) {
    const bytes = await window.petDesktop.getModel();
    return bytes ? new Uint8Array(bytes).buffer : null;
  }
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readonly');
      const request = tx.objectStore('models').get('current');
      request.onsuccess = () => resolve(request.result instanceof ArrayBuffer ? request.result : null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveModel(buffer: ArrayBuffer) {
  if (window.petDesktop) { await window.petDesktop.setModel(new Uint8Array(buffer)); return; }
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('models', 'readwrite');
      tx.objectStore('models').put(buffer, 'current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
