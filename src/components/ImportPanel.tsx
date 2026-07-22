import { useEffect, useRef, useState } from "react";
import type { Dims, FurnitureItem, ModelRotation, SceneFile, TintBlendMode } from "../schema/scene";
import { loadFalKey } from "../storage/settings";
import { putAsset } from "../storage/assets";
import { generateFurnitureGlb, FalKeyMissingError, type GenerationPhase } from "../import/falClient";
import { applyFurnitureImport } from "../import/applyImport";
import { applyFlatTexture } from "../import/applyFlatTexture";
import { furnitureOverallDims, isBoxFurnitureItem, type BoxFurnitureItem } from "../scene/buildScene";
import { slugify, uniqueId } from "../util/slug";
import { dimsAreValid, ObjectEditFields } from "./ObjectEditFields";
import { ObjectPreview3D } from "./ObjectPreview3D";
import { useDebouncedCallback } from "../util/useDebouncedCallback";
import "./ImportPanel.css";

// improvements-v2.2 §5: same debounce window ShellPanel.tsx's surface tint
// picker uses — a `<input type="color">` drag fires onChange continuously,
// and each commit here triggers a full structural scene rebuild (see
// TintRow below), not just a cheap in-place material tweak.
const TINT_DEBOUNCE_MS = 120;

type Stage =
  | { kind: "pick" }
  | { kind: "confirm-cost"; photo: File }
  | { kind: "generating"; photo: File; phase: GenerationPhase; message?: string }
  | { kind: "confirm-dims"; glbBlob: Blob; photoBlob: Blob | File; dims: Dims; modelRotationDeg: ModelRotation }
  | { kind: "error"; message: string; photo: File; photoUrl: string | null };

// furnitureOverallDims (not a raw item.dimsCm check) so a compound-sofa's
// derived main+chaise footprint pre-fills correctly instead of falling
// through to the 50x50x50 default — code-review finding: re-importing a
// compound-sofa used to persist a stray literal dimsCm that permanently
// overrode its main/chaise-derived footprint everywhere else in the app.
function dimsOf(item: FurnitureItem | undefined): Dims {
  if (!item) return { w: 50, d: 50, h: 50 };
  return furnitureOverallDims(item);
}

const ZERO_ROTATION: ModelRotation = { x: 0, y: 0, z: 0 };

const PROGRESS_LABEL: Record<GenerationPhase, string> = {
  uploading: "Uploading photo…",
  queued: "Queued on fal.ai…",
  generating: "Generating mesh via Hunyuan3D…",
  downloading: "Downloading model…",
};

export function ImportPanel({
  sceneFile,
  onImported,
}: {
  sceneFile: SceneFile;
  onImported: (next: SceneFile) => void;
}) {
  // All items are selectable, including ones with a glbHash already —
  // picking an already-imported item re-runs the import and replaces its
  // photo/model/dims/orientation (fixes a wrong source photo without
  // needing a separate "delete and re-add" flow).
  const [selection, setSelection] = useState<string>("__new__");
  const [newName, setNewName] = useState("");
  const [hasFalKey, setHasFalKey] = useState<boolean | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "pick" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFalKey().then((key) => setHasFalKey(key !== null));
  }, []);

  const selectedItem = selection === "__new__" ? undefined : sceneFile.items.find((i) => i.id === selection);

  function handlePhotoPicked(file: File) {
    setStage({ kind: "confirm-cost", photo: file });
  }

  async function runGeneration(photo: File, photoUrl: string | null) {
    setStage({ kind: "generating", photo, phase: "uploading" });
    let uploadedUrl: string | null = photoUrl;
    try {
      const falKey = await loadFalKey();
      if (!falKey) throw new FalKeyMissingError();
      const { glbBlob } = await generateFurnitureGlb(
        uploadedUrl ? { url: uploadedUrl } : photo,
        falKey,
        (p) => setStage({ kind: "generating", photo, phase: p.phase, message: p.message }),
        (url) => {
          uploadedUrl = url;
        },
      );
      setStage({
        kind: "confirm-dims",
        glbBlob,
        photoBlob: photo,
        // dims are a reasonable carry-over guess (the real-world object is
        // presumably the same size) but rotation is not: this is a freshly
        // generated GLB with its own, unrelated orientation quirks, so it
        // always starts from zero rather than the previous model's
        // correction (code-review finding — a re-import used to silently
        // inherit a stale correction that no longer applied).
        dims: dimsOf(selectedItem),
        modelRotationDeg: ZERO_ROTATION,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStage({ kind: "error", message, photo, photoUrl: uploadedUrl });
    }
  }

  async function handleConfirmDims(dims: Dims, modelRotationDeg: ModelRotation) {
    if (stage.kind !== "confirm-dims") return;
    const { glbBlob, photoBlob } = stage;

    const [sourcePhotoHash, glbHash] = await Promise.all([putAsset(photoBlob), putAsset(glbBlob)]);

    const itemId =
      selection === "__new__"
        ? uniqueId(
            slugify(newName || "new-item", "item"),
            new Set(sceneFile.items.map((i) => i.id)),
          )
        : selection;

    const isZeroRotation = modelRotationDeg.x === 0 && modelRotationDeg.y === 0 && modelRotationDeg.z === 0;

    const next = applyFurnitureImport(sceneFile, {
      itemId,
      newItemName: selection === "__new__" ? newName || "New item" : undefined,
      dimsCm: dims,
      sourcePhotoHash,
      glbHash,
      modelRotationDeg: isZeroRotation ? undefined : modelRotationDeg,
    });
    onImported(next);
    setStage({ kind: "pick" });
    setNewName("");
    setSelection("__new__");
  }

  // Phase 6 (PRD §7.6): the flat-texture upload control, replacing the only
  // prior path of hand-editing flatTextureHash into the persisted project
  // record. No fal.ai call, no dims/rotation confirmation step — the raw
  // photo is stored as-is (Viewport.tsx does content-box detection and the
  // cover-fit crop live, from the item's real dimsCm, at render time; see
  // its `detectContentBox` and `computeFlatTextureFit` usage), so this is a
  // one-step upload -> commit, same "discrete, deliberate action, persist
  // immediately" treatment `onImported` already gives a completed import.
  async function handleFlatTextureUpload(itemId: string, file: File): Promise<void> {
    const hash = await putAsset(file);
    const next = applyFlatTexture(sceneFile, itemId, hash);
    onImported(next);
  }

  // improvements-v2.2 §5: per-item tint commit, same shape as
  // handleFlatTextureUpload above — a direct field set on the matching item,
  // no async asset store involved (a color string persists straight into
  // the scene file, unlike a photo). `tintColor` undefined clears the tint
  // (renders at the material's natural color); the union spread preserves
  // whichever branch (box vs. compound-sofa) `item` actually is.
  function handleTintChange(itemId: string, tintColor: string | undefined) {
    const items: FurnitureItem[] = sceneFile.items.map((item) =>
      item.id === itemId ? { ...item, tintColor } : item,
    );
    onImported({ ...sceneFile, items });
  }

  // improvements-minor-fixes §10: blend-mode commit, same shape as
  // handleTintChange above. A `<select>` change is a discrete pick, not a
  // drag, so this commits immediately — no debounce, same reasoning
  // handleClear (below, in TintRow) already uses for its own immediate
  // commit.
  function handleBlendModeChange(itemId: string, tintBlendMode: TintBlendMode) {
    const items: FurnitureItem[] = sceneFile.items.map((item) =>
      item.id === itemId ? { ...item, tintBlendMode } : item,
    );
    onImported({ ...sceneFile, items });
  }

  const canPickPhoto =
    hasFalKey === true && (selection !== "__new__" || newName.trim().length > 0) && stage.kind === "pick";

  return (
    <div className="import-panel">
      <h2 className="import-panel-title">Furniture import</h2>

      <p className="import-panel-note">
        Placement is seeded from a one-time Figma conversion — items snap to the position/rotation
        drawn there. If the room layout changes in Figma, that conversion has to be redone by hand;
        this app won't detect or reflect the change on its own.
      </p>

      {hasFalKey === false && (
        <p className="import-panel-warning">Add a fal.ai key in Settings before importing furniture.</p>
      )}

      {stage.kind === "pick" && (
        <>
          <label className="import-field">
            <span>Item</span>
            <select value={selection} onChange={(e) => setSelection(e.target.value)}>
              <option value="__new__">+ New item…</option>
              {sceneFile.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.glbHash ? " (re-import, replaces current model)" : ""}
                </option>
              ))}
            </select>
          </label>

          {selection === "__new__" && (
            <label className="import-field">
              <span>Name</span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Reading chair"
              />
            </label>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="import-panel-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handlePhotoPicked(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="import-panel-button"
            disabled={!canPickPhoto}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload photo…
          </button>

          {selectedItem && (
            <TintRow
              item={selectedItem}
              onChange={(tintColor) => handleTintChange(selectedItem.id, tintColor)}
              onBlendModeChange={(mode) => handleBlendModeChange(selectedItem.id, mode)}
            />
          )}

          {selectedItem && isBoxFurnitureItem(selectedItem) && (
            <FlatTextureRow item={selectedItem} onUpload={(file) => handleFlatTextureUpload(selectedItem.id, file)} />
          )}
        </>
      )}

      {stage.kind === "confirm-cost" && (
        <div className="import-panel-confirm">
          {selectedItem?.glbHash && (
            <p className="import-panel-warning">
              "{selectedItem.name}" already has an imported model — generating replaces its current
              photo, model, dimensions, and orientation correction. This can't be undone from here.
            </p>
          )}
          <p>
            Generating a 3D model via fal.ai's Hunyuan3D costs real money on your fal.ai account. Proceed
            with this generation?
          </p>
          <div className="import-panel-actions">
            <button type="button" className="import-panel-button" onClick={() => void runGeneration(stage.photo, null)}>
              Generate
            </button>
            <button type="button" className="import-panel-button-secondary" onClick={() => setStage({ kind: "pick" })}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage.kind === "generating" && (
        <div className="import-panel-progress">
          <p>{PROGRESS_LABEL[stage.phase]}</p>
          {stage.message && <p className="import-panel-progress-detail">{stage.message}</p>}
        </div>
      )}

      {stage.kind === "confirm-dims" && (
        <DimsConfirmForm
          glbBlob={stage.glbBlob}
          initialDims={stage.dims}
          initialRotation={stage.modelRotationDeg}
          onConfirm={(dims, modelRotationDeg) => void handleConfirmDims(dims, modelRotationDeg)}
        />
      )}

      {stage.kind === "error" && (
        <div className="import-panel-error">
          <p>Generation failed: {stage.message}</p>
          <div className="import-panel-actions">
            <button
              type="button"
              className="import-panel-button"
              onClick={() => void runGeneration(stage.photo, stage.photoUrl)}
            >
              Retry{stage.photoUrl ? " (reuse uploaded photo)" : ""}
            </button>
            <button type="button" className="import-panel-button-secondary" onClick={() => setStage({ kind: "pick" })}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// The picker's own "no color chosen" value — shown when an item has no
// tintColor, and what "Clear tint" resets the live picker display to (the
// actual persisted field goes to `undefined`, not this string; see
// handleTintChange's comment for why those two are kept distinct).
const NO_TINT = "#ffffff";

// improvements-v2.2 §5: per-item color tint control, extending the shell
// surface tint pattern (ShellPanel.tsx's SurfaceRow) to furniture. Shown for
// both box and compound-sofa items (unlike FlatTextureRow below, which is
// box-only), so it's its own conditional block at the call site rather than
// nested inside an isBoxFurnitureItem check.
function TintRow({
  item,
  onChange,
  onBlendModeChange,
}: {
  item: FurnitureItem;
  onChange: (tintColor: string | undefined) => void;
  onBlendModeChange: (mode: TintBlendMode) => void;
}) {
  // Local mirror of the picker's color for instant feedback while dragging —
  // same reasoning as ShellPanel.tsx's SurfaceRow liveCalib: onChange is
  // debounced below (it drives a full structural scene rebuild), so the
  // input itself needs its own unthrottled state to feel live.
  const [liveColor, setLiveColor] = useState(item.tintColor ?? NO_TINT);
  useEffect(() => setLiveColor(item.tintColor ?? NO_TINT), [item.tintColor]);
  const debouncedOnChange = useDebouncedCallback(onChange, TINT_DEBOUNCE_MS);

  function handlePick(next: string) {
    setLiveColor(next);
    debouncedOnChange(next);
  }

  function handleClear() {
    setLiveColor(NO_TINT);
    onChange(undefined); // a discrete click, not a drag — commit immediately, no debounce
  }

  return (
    <section className="import-panel-tint">
      <header className="import-panel-tint-header">
        <span className="import-panel-tint-title">Tint</span>
        <span
          className={`import-panel-tint-status import-panel-tint-status--${item.tintColor ? "set" : "none"}`}
        >
          {item.tintColor ? "tinted" : "natural color"}
        </span>
      </header>
      <label className="import-field">
        <span>Color</span>
        <input type="color" value={liveColor} onChange={(e) => handlePick(e.target.value)} />
      </label>
      {item.tintColor && (
        <>
          {/* improvements-minor-fixes §10: only Multiply/Screen are
              implemented this round — overlay/soft-light/darken exist in the
              schema (TintBlendMode) for a later round but aren't rendered
              here as dead options. Rendered only inside this same
              `item.tintColor` check as "Clear tint" — the mode has no effect
              without a tint set. */}
          <label className="import-field">
            <span>Blend mode</span>
            <select
              value={item.tintBlendMode ?? "multiply"}
              onChange={(e) => onBlendModeChange(e.target.value as TintBlendMode)}
            >
              <option value="multiply">Multiply</option>
              <option value="screen">Screen</option>
            </select>
          </label>
          <button type="button" className="import-panel-button-secondary" onClick={handleClear}>
            Clear tint
          </button>
        </>
      )}
    </section>
  );
}

// Phase 6 (PRD §7.6): per-item "use flat photo texture" control, mirroring
// ShellPanel.tsx's SurfaceRow (status pill + upload/replace button + error
// state) rather than inventing a new upload pattern. Box items only — see
// isBoxFurnitureItem's call site above and schema/scene.ts's flatTextureHash
// comment for why (a compound-sofa's multi-part footprint has no single "top
// face" to map a flat photo onto).
function FlatTextureRow({
  item,
  onUpload,
}: {
  item: BoxFurnitureItem;
  onUpload: (file: File) => Promise<void>;
}) {
  const [status, setStatus] = useState<"idle" | "processing" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setStatus("processing");
    try {
      await onUpload(file);
      setStatus("idle");
    } catch (err) {
      console.error("[ImportPanel] flat-texture upload failed", err);
      setStatus("error");
    }
  }

  return (
    <section className="import-panel-flat-texture">
      <header className="import-panel-flat-texture-header">
        <span className="import-panel-flat-texture-title">Flat photo texture</span>
        <span
          className={`import-panel-flat-texture-status import-panel-flat-texture-status--${
            item.flatTextureHash ? "photo" : "none"
          }`}
        >
          {item.flatTextureHash ? "photo applied" : "none"}
        </span>
      </header>

      <p className="import-panel-flat-texture-hint">
        For flat, pattern-is-the-point items (rugs and the like) — a straight-on photo mapped 1:1 onto
        "{item.name}"'s real footprint, instead of generating a 3D model.
        {item.glbHash && " This item already has a generated model, which takes priority if both are set."}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="import-panel-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="import-panel-button-secondary"
        onClick={() => inputRef.current?.click()}
        disabled={status === "processing"}
      >
        {status === "processing" ? "Processing…" : item.flatTextureHash ? "Replace photo" : "Upload photo"}
      </button>
      {status === "error" && (
        <p className="import-panel-dims-error">Couldn't store that photo — try another.</p>
      )}
    </section>
  );
}

// improvements-v2.2 §6, high priority: was plain number inputs/dropdowns
// applied blind, no rendering at all before the item got placed in the real
// room — real money is spent per fal.ai generation and there was previously
// no way to fix a bad import after confirming. Now renders a live, orbit-
// able 3D preview (ObjectPreview3D) alongside the fields (ObjectEditFields,
// shared with Viewport.tsx's post-import docked editor — see
// ObjectInspector.tsx) so editing W/D/H/rotation shows the actual result
// before it's ever placed.
function DimsConfirmForm({
  glbBlob,
  initialDims,
  initialRotation,
  onConfirm,
}: {
  glbBlob: Blob;
  initialDims: Dims;
  initialRotation: ModelRotation;
  onConfirm: (dims: Dims, modelRotationDeg: ModelRotation) => void;
}) {
  const [dims, setDims] = useState(initialDims);
  const [rotation, setRotation] = useState(initialRotation);
  return (
    <div className="import-panel-dims">
      <p>Model generated — confirm its real-world size (cm) before placing it.</p>

      <ObjectPreview3D glbBlob={glbBlob} dims={dims} modelRotationDeg={rotation} />

      <p className="object-edit-hint">
        If the model is lying on its side or facing the wrong way, correct it below before
        placing — the generator doesn't always output the model upright/forward-facing. Corrections are
        applied in X, then Y, then Z order; if only one axis is off, set just that one. If the
        model needs two axes corrected at once, order matters and there's no way to change it
        here — try each axis alone first to see which one it actually needs. The preview above
        updates live as you edit either.
      </p>

      <ObjectEditFields dims={dims} onDimsChange={setDims} rotation={rotation} onRotationChange={setRotation} />

      <button
        type="button"
        className="import-panel-button"
        disabled={!dimsAreValid(dims)}
        onClick={() => onConfirm(dims, rotation)}
      >
        Confirm and place
      </button>
    </div>
  );
}
