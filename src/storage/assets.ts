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

/** Store a blob; returns its content hash. Idempotent — skips the write if the
 *  same bytes are already present. */
export async function putAsset(blob: Blob): Promise<string> {
  const hash = await hashBlob(blob);
  const dir = await assetsDir();
  if (await handleExists(dir, hash)) return hash;
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

function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotFoundError";
}
