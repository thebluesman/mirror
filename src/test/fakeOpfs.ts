// In-memory OPFS shim for tests. OPFS (navigator.storage.getDirectory) has no
// implementation in the Node test environment, so the asset store is exercised
// against this minimal fake covering exactly the subset assets.ts touches:
// getDirectoryHandle / getFileHandle (with `create`), createWritable, getFile,
// and a NotFoundError DOMException on a missing entry. This is the "mock OPFS"
// the Phase 2 brief allows; a real-OPFS integration test needs a browser.

import { vi } from "vitest";

class FakeWritable {
  private chunks: BlobPart[] = [];
  private commit: (blob: Blob) => void;
  constructor(commit: (blob: Blob) => void) {
    this.commit = commit;
  }
  async write(data: BlobPart): Promise<void> {
    this.chunks.push(data);
  }
  async close(): Promise<void> {
    this.commit(new Blob(this.chunks));
  }
}

class FakeFileHandle {
  readonly kind = "file";
  private name: string;
  private store: Map<string, Blob>;
  constructor(name: string, store: Map<string, Blob>) {
    this.name = name;
    this.store = store;
  }
  async getFile(): Promise<Blob> {
    const blob = this.store.get(this.name);
    if (!blob) throw new DOMException(`no file "${this.name}"`, "NotFoundError");
    return blob;
  }
  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable((blob) => this.store.set(this.name, blob));
  }
}

class FakeDirHandle {
  readonly kind = "directory";
  private files = new Map<string, Blob>();
  private dirs = new Map<string, FakeDirHandle>();

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDirHandle> {
    let dir = this.dirs.get(name);
    if (!dir) {
      if (!opts?.create) throw new DOMException(`no dir "${name}"`, "NotFoundError");
      dir = new FakeDirHandle();
      this.dirs.set(name, dir);
    }
    return dir;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FakeFileHandle> {
    if (!this.files.has(name)) {
      if (!opts?.create) throw new DOMException(`no file "${name}"`, "NotFoundError");
      this.files.set(name, new Blob()); // placeholder until written/closed
    }
    return new FakeFileHandle(name, this.files);
  }
}

/**
 * Install a fresh in-memory OPFS as navigator.storage for the current test.
 * Returns a reset() that clears it. Pair with vi.unstubAllGlobals() in cleanup.
 */
export function installFakeOpfs(): { reset: () => void } {
  let root = new FakeDirHandle();
  vi.stubGlobal("navigator", {
    storage: { getDirectory: async () => root },
  });
  return {
    reset: () => {
      root = new FakeDirHandle();
      vi.stubGlobal("navigator", { storage: { getDirectory: async () => root } });
    },
  };
}
