// OPFS content-addressed asset store (Phase 2, PRD §8). Binary assets — source
// photos, generated GLBs, textures — live in OPFS, keyed by the SHA-256 of
// their bytes; the scene JSON references them by that hash. Nothing populates
// this yet (Phase 4's Meshy import does); this is the primitive it builds on.
//
// Content-addressing means put is idempotent: the same bytes always map to the
// same filename, so re-importing an identical asset is a no-op, and a hash in
// the JSON either resolves to exactly those bytes or is absent.

const ASSETS_DIR = "assets";

async function assetsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(ASSETS_DIR, { create: true });
}

/** SHA-256 of a blob's bytes, lowercase hex. */
export async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Store a blob; returns its content hash. Idempotent — skips the write if
 *  the same bytes are already present. Verifies the existing file's actual
 *  content, not just its size (Phase 2 code-review finding, closed in Phase
 *  4 now that real imports exist to interrupt, then tightened by Phase 4's
 *  own code-review): a write that got cut off mid-`createWritable` — e.g.
 *  the tab closed during a large GLB import — can leave a 0-byte or
 *  otherwise-partial stub under the target hash. A size-only check closes
 *  the 0-byte case but would still trust a same-size corrupted stub forever;
 *  re-hashing the existing bytes on a size match closes that gap too, at the
 *  cost of one extra hash of the existing file only on the (rare) match
 *  path — every non-matching or first-time write is unaffected. */
export async function putAsset(blob: Blob): Promise<string> {
  const hash = await hashBlob(blob);
  const dir = await assetsDir();
  if (await isStoredCorrectly(dir, hash, blob)) return hash;
  const fileHandle = await dir.getFileHandle(hash, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return hash;
}

/** Retrieve a stored asset, or null if the hash isn't present. */
export async function getAsset(hash: string): Promise<Blob | null> {
  const dir = await assetsDir();
  try {
    const fileHandle = await dir.getFileHandle(hash);
    return await fileHandle.getFile();
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Whether an asset with this hash is stored. */
export async function hasAsset(hash: string): Promise<boolean> {
  const dir = await assetsDir();
  return handleExists(dir, hash);
}

async function handleExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/** Whether a file already exists at `hash` and its content actually matches
 *  `blob` (size, then a full re-hash) — not just its presence or size. */
async function isStoredCorrectly(dir: FileSystemDirectoryHandle, hash: string, blob: Blob): Promise<boolean> {
  try {
    const fileHandle = await dir.getFileHandle(hash);
    const file = await fileHandle.getFile();
    if (file.size !== blob.size) return false;
    return (await hashBlob(file)) === hash;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotFoundError";
}
