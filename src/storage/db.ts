// Shared IndexedDB connection for the "mirror" database. autosave.ts (Phase 2)
// and settings.ts (Phase 4) both store into this one database under separate
// object stores — a single open/upgrade path here means adding a store never
// leaves an earlier module requesting a version behind the current schema
// (IDBFactory.open throws VersionError if a caller's version is lower than
// the database's actual version, which two independent DB_VERSION constants
// would eventually hit).

export const DB_NAME = "mirror";
export const DB_VERSION = 2;
export const PROJECT_STORE = "project";
export const SETTINGS_STORE = "settings";

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PROJECT_STORE)) {
        req.result.createObjectStore(PROJECT_STORE);
      }
      if (!req.result.objectStoreNames.contains(SETTINGS_STORE)) {
        req.result.createObjectStore(SETTINGS_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function runTx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = op(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
