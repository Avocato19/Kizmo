export type LocalFolder = { id: string; title: string; createdAt: string; archived?: boolean };
export type LocalSet = { id: string; title: string; image: string; masks: unknown[]; createdAt: string; folderId: string };
export type AppSnapshot = { folders: LocalFolder[]; sets: LocalSet[] };

const DB_NAME = 'kizmo-study';
const STORE_NAME = 'app-data';
const STATE_KEY = 'snapshot';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local storage.'));
  });
}

export async function readSnapshot(): Promise<AppSnapshot> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => {
      db.close();
      resolve(request.result ?? { folders: [], sets: [] });
    };
    request.onerror = () => { db.close(); reject(request.error ?? new Error('Could not read local data.')); };
  });
}

export async function writeSnapshot(snapshot: AppSnapshot): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(snapshot, STATE_KEY);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('Could not save local data.')); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('Could not save local data.')); };
  });
}
