// Local app settings (Phase 4, PRD §8) — currently just the fal.ai API key,
// pasted once into the Settings panel. Stored in IndexedDB (shared "mirror"
// database, see db.ts), never bundled, never sent anywhere but fal.ai. A
// separate object store from autosave.ts's "project" store — settings and
// project data have unrelated lifecycles (clearing/reimporting a project
// shouldn't touch the key).

import { openDB, runTx, SETTINGS_STORE } from "./db";

const FAL_KEY_SETTING = "falKey";

/** Persist the fal.ai key. */
export async function saveFalKey(key: string): Promise<void> {
  const db = await openDB();
  try {
    await runTx(db, SETTINGS_STORE, "readwrite", (store) => store.put(key, FAL_KEY_SETTING));
  } finally {
    db.close();
  }
}

/** The stored fal.ai key, or null if none has been saved yet. */
export async function loadFalKey(): Promise<string | null> {
  const db = await openDB();
  try {
    const raw = await runTx<unknown>(db, SETTINGS_STORE, "readonly", (store) => store.get(FAL_KEY_SETTING));
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } finally {
    db.close();
  }
}

export async function clearFalKey(): Promise<void> {
  const db = await openDB();
  try {
    await runTx(db, SETTINGS_STORE, "readwrite", (store) => store.delete(FAL_KEY_SETTING));
  } finally {
    db.close();
  }
}
