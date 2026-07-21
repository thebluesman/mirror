import { useEffect, useRef, useState } from "react";
import type { Dims, FurnitureItem, ModelRotation, SceneFile } from "../schema/scene";
import { loadFalKey } from "../storage/settings";
import { putAsset } from "../storage/assets";
import { generateFurnitureGlb, FalKeyMissingError, type GenerationPhase } from "../import/falClient";
import { applyFurnitureImport } from "../import/applyImport";
import { slugify, uniqueId } from "../util/slug";
import "./ImportPanel.css";

type Stage =
  | { kind: "pick" }
  | { kind: "confirm-cost"; photo: File }
  | { kind: "generating"; photo: File; phase: GenerationPhase; message?: string }
  | { kind: "confirm-dims"; glbBlob: Blob; photoBlob: Blob | File; dims: Dims; modelRotationDeg: ModelRotation }
  | { kind: "error"; message: string; photo: File; photoUrl: string | null };

function dimsOf(item: FurnitureItem | undefined): Dims {
  if (item?.dimsCm) return item.dimsCm;
  return { w: 50, d: 50, h: 50 };
}

const ZERO_ROTATION: ModelRotation = { x: 0, y: 0, z: 0 };

function modelRotationOf(item: FurnitureItem | undefined): ModelRotation {
  return item?.modelRotationDeg ?? ZERO_ROTATION;
}

const PROGRESS_LABEL: Record<GenerationPhase, string> = {
  uploading: "Uploading photo…",
  queued: "Queued on fal.ai…",
  generating: "Generating mesh via Meshy…",
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
        dims: dimsOf(selectedItem),
        modelRotationDeg: modelRotationOf(selectedItem),
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
        </>
      )}

      {stage.kind === "confirm-cost" && (
        <div className="import-panel-confirm">
          <p>
            Generating a 3D model via fal.ai's Meshy costs real money on your fal.ai account. Proceed
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

// Code-review finding: the `min={1}` on the number inputs below is only an
// HTML hint — it doesn't stop a cleared/negative value from reaching
// onConfirm (Number("") is 0, not NaN, so isNaN alone wouldn't catch it
// either). A 0/negative/non-finite dim would fitModelToDims to a
// zero/mirrored/degenerate scale and, since the schema's Dims has no
// positivity constraint, persist that way with no in-app fix in v1.
function isValidDim(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

const ROTATION_STEPS = [0, 90, 180, 270] as const;

function DimsConfirmForm({
  initialDims,
  initialRotation,
  onConfirm,
}: {
  initialDims: Dims;
  initialRotation: ModelRotation;
  onConfirm: (dims: Dims, modelRotationDeg: ModelRotation) => void;
}) {
  const [dims, setDims] = useState(initialDims);
  const [rotation, setRotation] = useState(initialRotation);
  const invalid = (["w", "d", "h"] as const).filter((axis) => !isValidDim(dims[axis]));
  return (
    <div className="import-panel-dims">
      <p>Model generated — confirm its real-world size (cm) before placing it.</p>
      <div className="import-panel-dims-row">
        {(["w", "d", "h"] as const).map((axis) => (
          <label key={axis} className="import-field">
            <span>{axis.toUpperCase()}</span>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={dims[axis]}
              onChange={(e) => setDims({ ...dims, [axis]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      {invalid.length > 0 && (
        <p className="import-panel-dims-error">
          {invalid.map((a) => a.toUpperCase()).join(", ")} must be a positive number.
        </p>
      )}

      <p className="import-panel-dims-hint">
        If the model is lying on its side or facing the wrong way, correct it here before
        placing — Meshy doesn't always output the model upright/forward-facing.
      </p>
      <div className="import-panel-dims-row">
        {(["x", "y", "z"] as const).map((axis) => (
          <label key={axis} className="import-field">
            <span>Rotate {axis.toUpperCase()}</span>
            <select
              value={rotation[axis]}
              onChange={(e) => setRotation({ ...rotation, [axis]: Number(e.target.value) })}
            >
              {ROTATION_STEPS.map((deg) => (
                <option key={deg} value={deg}>
                  {deg}°
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <button
        type="button"
        className="import-panel-button"
        disabled={invalid.length > 0}
        onClick={() => onConfirm(dims, rotation)}
      >
        Confirm and place
      </button>
    </div>
  );
}
