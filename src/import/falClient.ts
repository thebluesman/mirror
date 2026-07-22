// fal.ai Hunyuan3D client wrapper (v2 Phase 4, PRD-v2 §7.3; provider switch
// per ADR-0002 — Hunyuan3D replaces Meshy as the app's only image-to-3D
// provider, no fallback). ADR-0001 verified all three legs — upload,
// submit/poll, GLB download — work browser-direct with
// `fal.config({ credentials })`, no proxy; ADR-0002 amends only *which* fal-
// hosted model is called, so that architecture carries over unchanged (its
// one open item, a fresh browser-tab CORS re-check for Hunyuan, is PRD-v2
// §7.3's Phase 0 gate, run separately before this code ships). This module
// owns that configuration plus the async job flow's progress reporting;
// ImportPanel only sees `generateFurnitureGlb`.

import { fal } from "@fal-ai/client";
import type { QueueStatus } from "@fal-ai/client";

const ENDPOINT = "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d";

// Input arguments for Hunyuan3D's image-to-3D schema, confirmed live in the
// v2 spike's D5 call (ADR-0002): a single `input_image_url` (added per-call in
// generateFurnitureGlb below) plus `enable_pbr` for textured PBR output. The
// endpoint also exposes multi-view input fields, but v2 is single-photo only
// (PRD-v2 §11.5, decided) — they stay unset here, not scaffolded. fal's queue
// API echoes back unknown-field errors on a mismatch, so a schema drift fails
// loud during the confirm step rather than silently generating wrong output.
const REQUEST_DEFAULTS = {
  enable_pbr: true,
};

// Candidate key-paths (dot-separated) the image-to-3D response might carry the
// output GLB URL under. `model_glb.url` is Hunyuan3D's confirmed output path
// (D5 live call, ADR-0002) and so leads the list; the rest are kept as
// defensive fallbacks — the tolerant extractor exists precisely because fal's
// hosted-model schema "can change without notice" (ADR-0002 §Consequences), and
// a stale-but-harmless candidate costs nothing since `model_glb.url` wins
// whenever it's present. (`model_mesh.url` etc. were Meshy's shapes — left in
// as fallbacks, not because Meshy is still reachable; ADR-0002 removed that.)
const GLB_URL_KEY_CANDIDATES = [
  "model_glb.url",
  "model_mesh.url",
  "glb.url",
  "output.model_glb.url",
  "model_urls.glb",
  "mesh.url",
];

function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (typeof cur !== "object" || cur === null || !(part in cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function findGlbUrlAnywhere(obj: unknown): string | null {
  if (typeof obj === "string") {
    const lowered = obj.split("?", 1)[0].toLowerCase();
    return lowered.endsWith(".glb") ? obj : null;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const found = findGlbUrlAnywhere(v);
      if (found) return found;
    }
    return null;
  }
  if (typeof obj === "object" && obj !== null) {
    for (const v of Object.values(obj)) {
      const found = findGlbUrlAnywhere(v);
      if (found) return found;
    }
  }
  return null;
}

/** Extracts the generated GLB's URL from a fal response, tolerant of which
 *  exact key the endpoint uses (see GLB_URL_KEY_CANDIDATES above). Throws
 *  with the raw response attached if nothing that looks like a GLB URL is
 *  found anywhere, so a schema mismatch fails loud instead of silently
 *  downloading the wrong asset. */
function extractGlbUrl(result: unknown): string {
  for (const path of GLB_URL_KEY_CANDIDATES) {
    const val = getByPath(result, path);
    if (typeof val === "string" && val) return val;
  }
  const fallback = findGlbUrlAnywhere(result);
  if (fallback) return fallback;
  throw new Error(
    `fal.ai response had no recognizable GLB URL. Raw response: ${JSON.stringify(result)}`,
  );
}

export type GenerationPhase = "uploading" | "queued" | "generating" | "downloading";

export interface GenerationProgress {
  phase: GenerationPhase;
  message?: string;
}

export class FalKeyMissingError extends Error {
  constructor() {
    super("No fal.ai key saved — add one in Settings before generating furniture.");
    this.name = "FalKeyMissingError";
  }
}

function summarizeQueueStatus(status: QueueStatus): string | undefined {
  if (status.status === "IN_QUEUE") return `queued (position ${status.queue_position})`;
  if (status.status === "IN_PROGRESS") {
    const last = status.logs[status.logs.length - 1];
    return last?.message;
  }
  return undefined;
}

/**
 * Runs one photo through Hunyuan3D image-to-3D end to end: configure the client
 * with the caller-supplied key, upload the photo, submit + poll the job, and
 * download the resulting GLB. Reuses `photoUrl` instead of re-uploading when
 * given, so a failed generation's retry doesn't re-upload the same photo
 * (PRD §8: "retry is per-item and re-uses the uploaded photo"). Calls
 * `onPhotoUploaded` as soon as the upload leg completes — *before* the job is
 * submitted — so a caller can remember the URL for a same-photo retry even if
 * generation itself fails later (a failure after this point shouldn't force
 * a re-upload of bytes that already made it to fal's storage).
 */
export async function generateFurnitureGlb(
  photo: File | { url: string },
  falKey: string,
  onProgress: (p: GenerationProgress) => void,
  onPhotoUploaded?: (url: string) => void,
): Promise<{ glbBlob: Blob; photoUrl: string }> {
  if (!falKey) throw new FalKeyMissingError();
  fal.config({ credentials: falKey });

  let photoUrl: string;
  if ("url" in photo) {
    photoUrl = photo.url;
  } else {
    onProgress({ phase: "uploading" });
    photoUrl = await fal.storage.upload(photo);
  }
  onPhotoUploaded?.(photoUrl);

  onProgress({ phase: "queued" });
  const { data } = await fal.subscribe(ENDPOINT, {
    input: { ...REQUEST_DEFAULTS, input_image_url: photoUrl },
    logs: true,
    onQueueUpdate: (status) => {
      onProgress({
        phase: status.status === "IN_QUEUE" ? "queued" : "generating",
        message: summarizeQueueStatus(status),
      });
    },
  });

  const glbUrl = extractGlbUrl(data);
  onProgress({ phase: "downloading" });
  const res = await fetch(glbUrl);
  if (!res.ok) throw new Error(`GLB download failed: ${res.status} ${res.statusText}`);
  const glbBlob = await res.blob();

  return { glbBlob, photoUrl };
}
