import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import seedRaw from "../../seed/living-room.json";
import { parseScene, SCHEMA_VERSION, type SceneFile } from "../schema/scene";
import { saveProjectNow, saveProjectDebounced, loadProject, clearProject } from "./autosave";

// Fresh in-memory IndexedDB per test.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const seedScene: SceneFile = parseScene(seedRaw);

describe("IndexedDB autosave", () => {
  it("returns null on first run (nothing saved yet)", async () => {
    expect(await loadProject()).toBeNull();
  });

  it("saves and restores the project across a fresh DB connection", async () => {
    await saveProjectNow(seedScene);
    const restored = await loadProject();
    expect(restored).not.toBeNull();
    expect(restored).toEqual(seedScene);
  });

  it("re-validates and migrates on restore", async () => {
    // Simulate a project stored under the old draft version reaching restore.
    const draft = JSON.parse(JSON.stringify(seedScene)) as any;
    draft.meta.schemaVersion = "v1-draft";
    await saveProjectNow(draft as SceneFile);
    const restored = await loadProject();
    expect(restored!.meta.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("clears the autosave", async () => {
    await saveProjectNow(seedScene);
    await clearProject();
    expect(await loadProject()).toBeNull();
  });

  it("overwrites the previous save (single-project store)", async () => {
    await saveProjectNow(seedScene);
    const edited = JSON.parse(JSON.stringify(seedScene)) as SceneFile;
    edited.meta.source = "edited";
    await saveProjectNow(edited);
    const restored = await loadProject();
    expect(restored!.meta.source).toBe("edited");
  });

  // Code-review finding: an immediate save (e.g. saving a camera viewpoint)
  // used to be clobberable by a pending saveProjectDebounced write scheduled
  // just before it (e.g. a ShellPanel calibration drag) — the debounce
  // timer's closed-over, now-stale `scene` would fire later and overwrite
  // the immediate save. saveProjectNow now cancels any pending debounced
  // write first.
  it("an immediate save cancels a pending debounced write instead of racing it", async () => {
    const stale = JSON.parse(JSON.stringify(seedScene)) as SceneFile;
    stale.meta.source = "stale-debounced";
    saveProjectDebounced(stale, 20); // schedules a write of `stale` ~20ms out

    const fresh = JSON.parse(JSON.stringify(seedScene)) as SceneFile;
    fresh.meta.source = "fresh-immediate";
    await saveProjectNow(fresh); // should cancel the pending debounce timer above

    await new Promise((resolve) => setTimeout(resolve, 50)); // let the (now-cancelled) debounce window pass

    const restored = await loadProject();
    expect(restored!.meta.source).toBe("fresh-immediate");
  });
});
