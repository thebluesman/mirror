// Orphaned-generation recovery. fal.ai's Hunyuan3D call costs real money the
// moment it's enqueued, but the app used to only track that job in memory
// (ImportPanel's `Stage` union) — a closed tab, crash, or reload between
// submit and result meant the generation the user already paid for was
// unreachable, even though it had actually finished on fal's side. Each
// pending job's `request_id` (captured via fal.subscribe's `onEnqueue`, see
// falClient.ts) is persisted here the moment it's known, and cleared once
// its result has been fetched — so a later session can list what's still
// outstanding and re-poll/fetch it instead of losing it.

import { openDB, runTx, PENDING_IMPORTS_STORE } from "./db";

export interface PendingImport {
  requestId: string;
  /** fal.ai endpoint the job was submitted to — kept alongside requestId
   *  since queue.status/queue.result are scoped per-endpoint, and this
   *  endpoint constant could change across app versions (ADR-0002). */
  endpoint: string;
  /** Existing item's id if this was a re-import, undefined for a new item
   *  (which doesn't have an id yet — see newItemName below). */
  itemId?: string;
  /** Only set when itemId is undefined — the name typed into "+ New item…"
   *  at submit time, needed to resume into the same confirm-dims commit a
   *  normal new-item generation would produce. */
  newItemName?: string;
  /** Display label for the recovery list — item name at submit time, since
   *  itemId's live name could've changed by the time this is shown. */
  itemLabel: string;
  /** fal.ai storage URL of the uploaded source photo — recovery re-fetches
   *  it (fal keeps uploaded storage objects around independently of the
   *  queue job) to reconstruct the same photoBlob a normal generation would
   *  have, since the original File never survives a tab close/crash. */
  photoUrl: string;
  submittedAt: number;
}

export async function savePendingImport(entry: PendingImport): Promise<void> {
  const db = await openDB();
  try {
    await runTx(db, PENDING_IMPORTS_STORE, "readwrite", (store) => store.put(entry, entry.requestId));
  } finally {
    db.close();
  }
}

export async function clearPendingImport(requestId: string): Promise<void> {
  const db = await openDB();
  try {
    await runTx(db, PENDING_IMPORTS_STORE, "readwrite", (store) => store.delete(requestId));
  } finally {
    db.close();
  }
}

export async function listPendingImports(): Promise<PendingImport[]> {
  const db = await openDB();
  try {
    const all = await runTx<PendingImport[]>(db, PENDING_IMPORTS_STORE, "readonly", (store) => store.getAll());
    return all.sort((a, b) => a.submittedAt - b.submittedAt);
  } finally {
    db.close();
  }
}
