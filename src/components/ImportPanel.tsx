import { useEffect, useRef, useState } from "react";
import type { Dims, FurnitureItem, SceneFile } from "../schema/scene";
import { loadFalKey } from "../storage/settings";
import { putAsset } from "../storage/assets";
import { generateFurnitureGlb, FalKeyMissingError, type GenerationPhase } from "../import/falClient";
import { applyFurnitureImport } from "../import/applyImport";
import "./ImportPanel.css";

type Stage =
  | { kind: "pick" }
  | { kind: "confirm-cost"; photo: File }
  | { kind: "generating"; photo: File; phase: GenerationPhase; message?: string }
  | { kind: "confirm-dims"; glbBlob: Blob; photoBlob: Blob | File; dims: Dims }
  | { kind: "error"; message: string; photo: File; photoUrl: string | null };

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "item";
}

function uniqueId(base: string, existingIds: Set<string>): string {
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function dimsOf(item: FurnitureItem | undefined): Dims {
  if (item?.dimsCm) return item.dimsCm;
  return { w: 50, d: 50, h: 50 };
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
  const importableItems = sceneFile.items.filter((i) => !i.glbHash);
  const [selection, setSelection] = useState<string>("__new__");
  const [newName, setNewName] = useState("");
  const [hasFalKey, setHasFalKey] = useState<boolean | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "pick" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFalKey().then((key) => setHasFalKey(key !== null));
  }, []);

  // Once the selected item picks up a glbHash (via a completed import) it
  // drops out of importableItems on the next render — keep the dropdown
  // pointed at something that still exists instead of a stale id.
  useEffect(() => {
    if (selection !== "__new__" && !importableItems.some((i) => i.id === selection)) {
      setSelection("__new__");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-check when the importable set changes
  }, [importableItems.length]);

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
      setStage({ kind: "confirm-dims", glbBlob, photoBlob: photo, dims: dimsOf(selectedItem) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStage({ kind: "error", message, photo, photoUrl: uploadedUrl });
    }
  }

  async function handleConfirmDims(dims: Dims) {
    if (stage.kind !== "confirm-dims") return;
    const { glbBlob, photoBlob } = stage;

    const [sourcePhotoHash, glbHash] = await Promise.all([putAsset(photoBlob), putAsset(glbBlob)]);

    const itemId =
      selection === "__new__"
        ? uniqueId(
            slugify(newName || "new-item"),
            new Set(sceneFile.items.map((i) => i.id)),
          )
        : selection;

    const next = applyFurnitureImport(sceneFile, {
      itemId,
      newItemName: selection === "__new__" ? newName || "New item" : undefined,
      dimsCm: dims,
      sourcePhotoHash,
      glbHash,
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

      {hasFalKey === false && (
        <p className="import-panel-warning">Add a fal.ai key in Settings before importing furniture.</p>
      )}

      {stage.kind === "pick" && (
        <>
          <label className="import-field">
            <span>Item</span>
            <select value={selection} onChange={(e) => setSelection(e.target.value)}>
              <option value="__new__">+ New item…</option>
              {importableItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
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
        <DimsConfirmForm initial={stage.dims} onConfirm={(dims) => void handleConfirmDims(dims)} />
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

function DimsConfirmForm({ initial, onConfirm }: { initial: Dims; onConfirm: (dims: Dims) => void }) {
  const [dims, setDims] = useState(initial);
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
      <button
        type="button"
        className="import-panel-button"
        disabled={invalid.length > 0}
        onClick={() => onConfirm(dims)}
      >
        Confirm and place
      </button>
    </div>
  );
}
