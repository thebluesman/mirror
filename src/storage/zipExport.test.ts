import { describe, it, expect, afterEach, vi } from "vitest";
import { installFakeOpfs } from "../test/fakeOpfs";
import { parseScene, type SceneFile } from "../schema/scene";
import seedRaw from "../../seed/living-room.json";
import { referencedHashes, exportProjectZip, importProjectZip } from "./zipExport";
import { putAsset, getAsset } from "./assets";

afterEach(() => {
  vi.unstubAllGlobals();
});

const seedScene: SceneFile = parseScene(seedRaw);

describe("referencedHashes", () => {
  it("is empty for the seed (no assets imported yet)", () => {
    expect(referencedHashes(seedScene)).toEqual([]);
  });

  it("collects and dedups sourcePhotoHash and glbHash", () => {
    const scene = JSON.parse(JSON.stringify(seedScene)) as any;
    scene.items[0].sourcePhotoHash = "aaa";
    scene.items[0].glbHash = "bbb";
    scene.items[1].glbHash = "aaa"; // duplicate across items
    const hashes = referencedHashes(scene).sort();
    expect(hashes).toEqual(["aaa", "bbb"]);
  });
});

describe("zip export/import round-trip (fake OPFS)", () => {
  it("bundles project.json + referenced assets and restores them", async () => {
    installFakeOpfs();
    // Stage an asset in OPFS and reference it from the scene.
    const photoHash = await putAsset(new Blob(["photo-bytes"]));
    const scene = JSON.parse(JSON.stringify(seedScene)) as any;
    scene.items[0].sourcePhotoHash = photoHash;

    const zipBlob = await exportProjectZip(scene as SceneFile);
    expect(zipBlob.size).toBeGreaterThan(0);

    // Wipe OPFS, then import the zip and confirm the asset is rehydrated.
    installFakeOpfs();
    expect(await getAsset(photoHash)).toBeNull();

    const imported = await importProjectZip(zipBlob);
    expect((imported.items[0] as any).sourcePhotoHash).toBe(photoHash);
    const restored = await getAsset(photoHash);
    expect(restored).not.toBeNull();
    expect(await restored!.text()).toBe("photo-bytes");
  });
});
