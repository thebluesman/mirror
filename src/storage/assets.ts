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
 *  the same bytes are already present. Checks the existing file's *size*
 *  against `blob.size` before trusting it, not just its presence (Phase 2
 *  code-review finding, closed here now that Phase 4 has real imports to
 *  interrupt): a write that got cut off mid-`createWritable` — e.g. the tab
 *  closed during a large GLB import — can leave a 0-byte (or partial) stub
 *  under the target hash, which the old presence-only check would then mask
 *  as "already stored" forever. A size mismatch re-runs the write instead;
 *  a size match is trusted without re-hashing the existing bytes, same as
 *  the original design already trusted existence. */
export async function putAsset(blob: Blob): Promise<string> {
  const hash = await hashBlob(blob);
  const dir = await assetsDir();
  const existingSize = await handleSize(dir, hash);
  if (existingSize === blob.size) return hash;
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

/** The stored file's byte size, or null if it doesn't exist. */
async function handleSize(dir: FileSystemDirectoryHandle, name: string): Promise<number | null> {
  try {
    const fileHandle = await dir.getFileHandle(name);
    const file = await fileHandle.getFile();
    return file.size;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotFoundError";
}
