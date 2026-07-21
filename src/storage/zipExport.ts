// Zip export (Phase 2, PRD §8): "the project file" for portability is the
// scene JSON plus the OPFS binary assets it references, bundled together.
// fflate is a pure-JS zip lib (no native/Node deps) so it runs in the browser.
//
// Import (unzip back into a project + repopulated OPFS) belongs with the
// flows that consume assets (Phase 4); Phase 2 only needs the export half of
// portability working.

import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { getAsset, putAsset } from "./assets";
import { parseScene, type SceneFile } from "../schema/scene";

const PROJECT_ENTRY = "project.json";
const ASSET_PREFIX = "assets/";

/** Every OPFS asset hash the scene references (dedup'd). Pure — no OPFS access. */
export function referencedHashes(scene: SceneFile): string[] {
  const hashes = new Set<string>();
  for (const item of scene.items) {
    if (item.sourcePhotoHash) hashes.add(item.sourcePhotoHash);
    if (item.glbHash) hashes.add(item.glbHash);
  }
  // Phase 3 added photo-derived shell textures (room.shell.{wall,floor,ceiling}
  // .assetHash) — each is optional (no photo uploaded yet for that surface).
  const shell = scene.room.shell;
  if (shell?.wall?.assetHash) hashes.add(shell.wall.assetHash);
  if (shell?.floor?.assetHash) hashes.add(shell.floor.assetHash);
  if (shell?.ceiling?.assetHash) hashes.add(shell.ceiling.assetHash);
  return [...hashes];
}

/** Bundle project JSON + referenced OPFS assets into a zip blob. */
export async function exportProjectZip(scene: SceneFile): Promise<Blob> {
  const files: Record<string, Uint8Array> = {
    [PROJECT_ENTRY]: strToU8(JSON.stringify(scene, null, 2)),
  };
  for (const hash of referencedHashes(scene)) {
    const blob = await getAsset(hash);
    // A missing asset is skipped rather than fatal: a scene can reference a
    // hash whose bytes aren't local (e.g. opened from a JSON-only save). The
    // zip stays internally consistent for whatever assets are present.
    if (blob) files[`${ASSET_PREFIX}${hash}`] = new Uint8Array(await blob.arrayBuffer());
  }
  return new Blob([zipSync(files)], { type: "application/zip" });
}

/**
 * Inverse of exportProjectZip: validate the bundled project and rehydrate its
 * assets into OPFS. Returns the parsed scene. (Not wired into a UI in Phase 2 —
 * present so export has a tested round-trip partner.)
 */
export async function importProjectZip(zip: Blob): Promise<SceneFile> {
  const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  const projectBytes = entries[PROJECT_ENTRY];
  if (!projectBytes) throw new Error("zip has no project.json");
  const scene = parseScene(JSON.parse(strFromU8(projectBytes)));
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.startsWith(ASSET_PREFIX)) {
      await putAsset(new Blob([bytes as Uint8Array<ArrayBuffer>]));
    }
  }
  return scene;
}
