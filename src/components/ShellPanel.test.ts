import { describe, expect, it } from "vitest";
import { surfaceRowReducer, type SurfaceRowState } from "./ShellPanel";

const idle: SurfaceRowState = { status: "idle" };
const processing: SurfaceRowState = { status: "processing" };
const blob = new Blob(["fake"], { type: "image/jpeg" });
const preview: SurfaceRowState = { status: "preview", draftBlob: blob };
const committing: SurfaceRowState = { status: "committing", draftBlob: blob };
const error: SurfaceRowState = { status: "error" };

describe("surfaceRowReducer", () => {
  // docs/proposals/shell-texture-preview.md §1.2 (Option P-2, built
  // 2026-07-22) — the happy path: idle -> processing -> preview -> confirm
  // -> committing -> committed -> idle. Nothing here calls putAsset/onChange
  // (that's the component's job) — the reducer only tracks status/draftBlob.
  it("walks the full upload -> preview -> confirm -> commit cycle", () => {
    expect(surfaceRowReducer(idle, { type: "pickFile" })).toEqual(processing);
    expect(surfaceRowReducer(processing, { type: "blobReady", blob })).toEqual(preview);
    expect(surfaceRowReducer(preview, { type: "confirm" })).toEqual(committing);
    expect(surfaceRowReducer(committing, { type: "committed" })).toEqual(idle);
  });

  it("cancel from preview drops the draft and returns to idle untouched", () => {
    expect(surfaceRowReducer(preview, { type: "cancel" })).toEqual(idle);
  });

  it("a pipeline throw during processing goes to error, not preview", () => {
    expect(surfaceRowReducer(processing, { type: "pipelineError" })).toEqual(error);
  });

  it("a putAsset throw during committing goes to error (same as a pipeline throw)", () => {
    expect(surfaceRowReducer(committing, { type: "commitError" })).toEqual(error);
  });

  it("re-picking a file from error retries into processing", () => {
    expect(surfaceRowReducer(error, { type: "pickFile" })).toEqual(processing);
  });

  it("pickFile always resets to processing regardless of current status", () => {
    // Mirrors the original handleFile's unconditional setStatus("processing")
    // — a new upload always restarts the cycle even mid-preview/committing.
    expect(surfaceRowReducer(preview, { type: "pickFile" })).toEqual(processing);
    expect(surfaceRowReducer(committing, { type: "pickFile" })).toEqual(processing);
  });

  it("actions that don't apply to the current status are no-ops", () => {
    expect(surfaceRowReducer(idle, { type: "cancel" })).toEqual(idle);
    expect(surfaceRowReducer(idle, { type: "confirm" })).toEqual(idle);
    expect(surfaceRowReducer(idle, { type: "committed" })).toEqual(idle);
    expect(surfaceRowReducer(idle, { type: "commitError" })).toEqual(idle);
    expect(surfaceRowReducer(processing, { type: "confirm" })).toEqual(processing);
    expect(surfaceRowReducer(processing, { type: "cancel" })).toEqual(processing);
    expect(surfaceRowReducer(preview, { type: "committed" })).toEqual(preview);
    expect(surfaceRowReducer(preview, { type: "commitError" })).toEqual(preview);
    expect(surfaceRowReducer(preview, { type: "pipelineError" })).toEqual(preview);
    expect(surfaceRowReducer(committing, { type: "cancel" })).toEqual(committing);
  });

  it("blobReady only fires from processing — a stray blobReady elsewhere is ignored", () => {
    expect(surfaceRowReducer(idle, { type: "blobReady", blob })).toEqual(idle);
    expect(surfaceRowReducer(preview, { type: "blobReady", blob })).toEqual(preview);
  });
});
