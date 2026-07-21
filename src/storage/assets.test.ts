import { describe, it, expect, afterEach, vi } from "vitest";
import { installFakeOpfs } from "../test/fakeOpfs";
import { hashBlob, putAsset, getAsset, hasAsset } from "./assets";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hashBlob", () => {
  it("is deterministic and content-addressed", async () => {
    const a = await hashBlob(new Blob(["hello"]));
    const b = await hashBlob(new Blob(["hello"]));
    const c = await hashBlob(new Blob(["world"]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("matches the known SHA-256 of 'hello' as lowercase hex", async () => {
    const hash = await hashBlob(new Blob(["hello"]));
    expect(hash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});

describe("OPFS asset store (fake OPFS)", () => {
  it("stores and retrieves a blob by its hash", async () => {
    installFakeOpfs();
    const blob = new Blob(["glb-bytes"]);
    const hash = await putAsset(blob);
    expect(hash).toBe(await hashBlob(blob));

    expect(await hasAsset(hash)).toBe(true);
    const got = await getAsset(hash);
    expect(got).not.toBeNull();
    expect(await got!.text()).toBe("glb-bytes");
  });

  it("returns null / false for an absent hash", async () => {
    installFakeOpfs();
    expect(await getAsset("deadbeef")).toBeNull();
    expect(await hasAsset("deadbeef")).toBe(false);
  });

  it("is idempotent — putting the same bytes twice yields the same hash", async () => {
    installFakeOpfs();
    const h1 = await putAsset(new Blob(["same"]));
    const h2 = await putAsset(new Blob(["same"]));
    expect(h1).toBe(h2);
    expect(await hasAsset(h1)).toBe(true);
  });

  it("re-writes over a stale 0-byte stub left by an interrupted write", async () => {
    installFakeOpfs();
    const blob = new Blob(["real-bytes"]);
    const hash = await hashBlob(blob);
    // Simulate a write that got cut off mid-createWritable: a file handle was
    // created for this hash (e.g. an interrupted GLB import) but never
    // written to, leaving a 0-byte stub under the target hash.
    const dir = await navigator.storage.getDirectory();
    const stubHandle = await dir.getFileHandle(hash, { create: true });
    const stubFile = await stubHandle.getFile();
    expect(stubFile.size).toBe(0);

    const written = await putAsset(blob);
    expect(written).toBe(hash);
    const got = await getAsset(hash);
    expect(await got!.text()).toBe("real-bytes");
  });

  it("re-writes over a same-size but corrupted stub, not just a 0-byte one", async () => {
    installFakeOpfs();
    const blob = new Blob(["real-bytes"]); // 10 bytes
    const hash = await hashBlob(blob);
    // A same-length but wrong-content stub under the target hash — a size-only
    // idempotency check would have trusted this forever.
    const dir = await navigator.storage.getDirectory();
    const stubHandle = await dir.getFileHandle(hash, { create: true });
    const writable = await stubHandle.createWritable();
    await writable.write(new Blob(["corrupted!"])); // also 10 bytes, different content
    await writable.close();
    expect((await stubHandle.getFile()).size).toBe(blob.size);

    const written = await putAsset(blob);
    expect(written).toBe(hash);
    const got = await getAsset(hash);
    expect(await got!.text()).toBe("real-bytes");
  });
});
