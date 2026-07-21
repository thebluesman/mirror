import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import seedRaw from "../../seed/living-room.json";
import { parseScene, SCHEMA_VERSION, type SceneFile } from "../schema/scene";
import { saveProjectNow, loadProject, clearProject } from "./autosave";

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
});
