// IndexedDB autosave (Phase 2, PRD §8). The scene JSON is kilobytes, so the
// whole project is written under a single key on every change (debounced) and
// restored on load. This is what makes the project persist across a browser
// restart — the Phase 2 exit criterion — before any file has been opened.
//
// Restore runs the scene back through parseScene, so a project stored under an
// older schemaVersion migrates on the way out, same as a file open would.

import { parseScene, type SceneFile } from "../schema/scene";

const DB_NAME = "mirror";
const DB_VERSION = 1;
const STORE = "project";
const KEY = "current";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function runTx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Persist the project immediately. */
export async function saveProjectNow(scene: SceneFile): Promise<void> {
  const db = await openDB();
  try {
    // Store a structured-clone-safe plain object (JSON round-trip strips any
    // non-clonable oddities and matches what a file save would write).
    await runTx(db, "readwrite", (store) =>
      store.put(JSON.parse(JSON.stringify(scene)) as SceneFile, KEY),
    );
  } finally {
    db.close();
  }
}

/** Restore the autosaved project, or null on first run. Re-validates/migrates. */
export async function loadProject(): Promise<SceneFile | null> {
  const db = await openDB();
  try {
    const raw = await runTx<unknown>(db, "readonly", (store) => store.get(KEY));
    if (raw == null) return null;
    return parseScene(raw);
  } finally {
    db.close();
  }
}

/** Clear the autosave (used by tests; handy for a "reset" affordance later). */
export async function clearProject(): Promise<void> {
  const db = await openDB();
  try {
    await runTx(db, "readwrite", (store) => store.delete(KEY));
  } finally {
    db.close();
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

/** Debounced autosave — coalesces rapid changes into one write. */
export function saveProjectDebounced(scene: SceneFile, delayMs = 500): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void saveProjectNow(scene);
  }, delayMs);
}
