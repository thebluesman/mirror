// IndexedDB autosave (Phase 2, PRD §8). The scene JSON is kilobytes, so the
// whole project is written under a single key on every change (debounced) and
// restored on load. This is what makes the project persist across a browser
// restart — the Phase 2 exit criterion — before any file has been opened.
//
// Restore runs the scene back through parseScene, so a project stored under an
// older schemaVersion migrates on the way out, same as a file open would.

import { parseScene, type SceneFile } from "../schema/scene";
import { openDB, runTx, PROJECT_STORE } from "./db";

const KEY = "current";

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

/** Persist the project immediately. Cancels any pending debounced write
 *  first — otherwise that write's closed-over (and now stale) `scene` could
 *  fire after this one and silently clobber it in IndexedDB, even though
 *  this call's `scene` is the newer one the caller actually wants persisted
 *  (code-review finding: a debounced ShellPanel calibration write racing an
 *  immediate save/delete of a camera viewpoint). */
export async function saveProjectNow(scene: SceneFile): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  const db = await openDB();
  try {
    // scene is always a zod-parsed SceneFile (plain numbers/strings/arrays),
    // already safe for IndexedDB's own structured clone in store.put.
    await runTx(db, PROJECT_STORE, "readwrite", (store) => store.put(scene, KEY));
  } finally {
    db.close();
  }
}

/** Restore the autosaved project, or null on first run. Re-validates/migrates. */
export async function loadProject(): Promise<SceneFile | null> {
  const db = await openDB();
  try {
    const raw = await runTx<unknown>(db, PROJECT_STORE, "readonly", (store) => store.get(KEY));
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
    await runTx(db, PROJECT_STORE, "readwrite", (store) => store.delete(KEY));
  } finally {
    db.close();
  }
}

/** Debounced autosave — coalesces rapid changes into one write. */
export function saveProjectDebounced(scene: SceneFile, delayMs = 500): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void saveProjectNow(scene);
  }, delayMs);
}
