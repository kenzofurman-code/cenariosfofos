// Local cache using IndexedDB. Works fully offline, no setup required.
// This is the "at least in cache" baseline — Firebase (firebase.js) is optional
// on top of this and syncs the same data to the cloud when configured.

const DB_NAME = 'monte-cenario-db';
const DB_VERSION = 1;

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('scenarios')) db.createObjectStore('scenarios', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('layouts')) db.createObjectStore('layouts', { keyPath: 'scenarioId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveScenarioLocal(scenario){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scenarios', 'readwrite');
    // don't persist the in-memory hue-shift cache, it's cheap to regenerate
    const { variantCache, ...toStore } = scenario;
    tx.objectStore('scenarios').put(toStore);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteScenarioLocal(id){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scenarios', 'readwrite');
    tx.objectStore('scenarios').delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadScenariosLocal(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scenarios', 'readonly');
    const req = tx.objectStore('scenarios').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLayoutLocal(scenarioId, items){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('layouts', 'readwrite');
    tx.objectStore('layouts').put({ scenarioId, items, savedAt: Date.now() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadLayoutLocal(scenarioId){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('layouts', 'readonly');
    const req = tx.objectStore('layouts').get(scenarioId);
    req.onsuccess = () => resolve(req.result ? req.result.items : null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteLayoutLocal(scenarioId){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('layouts', 'readwrite');
    tx.objectStore('layouts').delete(scenarioId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

