import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Dims, FurnitureItem, ModelRotation } from "../schema/scene";
import { furnitureOverallDims } from "../scene/buildScene";
import { dimsAreValid, ObjectEditFields } from "./ObjectEditFields";
import "./ObjectInspector.css";

const COMMIT_DEBOUNCE_MS = 400;

export interface ObjectEditPatch {
  name: string;
  dimsCm: Dims;
  modelRotationDeg: ModelRotation;
}

const ZERO_ROTATION: ModelRotation = { x: 0, y: 0, z: 0 };

/**
 * improvements-v2.2 §6: post-import half of the shared edit flow — the same
 * fields ImportPanel's pre-confirm stage edits (ObjectEditFields, paired
 * there with ObjectPreview3D), docked in the real room viewport instead of
 * an isolated preview: this item is already placed, so the live Viewport
 * behind this panel IS the preview. Rendered by Viewport.tsx, conditional on
 * a selection.
 *
 * Edits commit through the normal `sceneFile.items` mutation path (`onEdit`,
 * threaded up through App.tsx's `commit()`) — the same discrete-action tail
 * every other scene edit uses. Viewport's existing structural-rebuild effect
 * already depends on `sceneFile.items`, so it picks the change up and
 * re-fits the model fresh from OPFS with the new dims/rotation — the same
 * "accept a full rebuild for a per-item property change" call
 * improvements-v2.2 §5's per-object tint already made, rather than building
 * a second live-mutate-in-place seam just for this panel.
 */
export function ObjectInspector({
  item,
  onEdit,
  onClose,
}: {
  item: FurnitureItem;
  onEdit: (patch: ObjectEditPatch) => void;
  onClose: () => void;
}) {
  // Code-review fix: a compound-sofa's W/D are derived from its `main`/
  // `chaise` sub-footprints (buildScene.ts's `furnitureFootprint`), which
  // never reads `dimsCm.w`/`.d` — only `dimsCm.h` is ever honored for that
  // shape. Editable W/D fields here would silently do nothing whenever the
  // item is still rendered as the box placeholder (no `glbHash` yet, e.g.
  // the seed's `applaryd-sofa`), so this shape only gets an editable H.
  const dimsAxes = item.shape === "compound-sofa" ? (["h"] as const) : undefined;

  const [name, setName] = useState(item.name);
  const [dims, setDims] = useState<Dims>(furnitureOverallDims(item));
  const [rotation, setRotation] = useState<ModelRotation>(item.modelRotationDeg ?? ZERO_ROTATION);

  // Resync local state when the selection changes to a different item, or
  // this same item changes from outside this panel (undo, e.g.) — same
  // "local mirror of a prop, refreshed via effect" shape as ShellPanel.tsx's
  // SurfaceRow. A debounced commit from this panel's own edits below lands
  // back here as a no-op (the values already match what was just typed).
  useEffect(() => {
    setName(item.name);
    setDims(furnitureOverallDims(item));
    setRotation(item.modelRotationDeg ?? ZERO_ROTATION);
  }, [item]);

  // Debounced commit: typing a dimension fires onChange per keystroke, and
  // committing mutates `sceneFile.items`, which Viewport.tsx's structural
  // effect reacts to with a full rebuild (renderer + re-decode the GLB from
  // OPFS) — fine once per pause in typing, not once per keystroke. Commits
  // all three fields together (not one onEdit call per field) so a rapid
  // multi-field edit lands as one scene mutation, not three.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function scheduleCommit(patch: ObjectEditPatch) {
    // Code-review precedent (ObjectEditFields.dimsAreValid): never persist a
    // 0/negative/non-finite dim mid-edit — the user is very likely just
    // clearing a field to type a new value, and the invalid state is
    // already surfaced inline by ObjectEditFields without needing this
    // panel to also block on it; it just skips committing until valid
    // again, same "gate the confirm, not the typing" shape ImportPanel uses.
    if (!dimsAreValid(patch.dimsCm, dimsAxes)) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onEditRef.current(patch);
    }, COMMIT_DEBOUNCE_MS);
  }

  function handleNameChange(next: string) {
    setName(next);
    scheduleCommit({ name: next, dimsCm: dims, modelRotationDeg: rotation });
  }
  function handleDimsChange(next: Dims) {
    setDims(next);
    scheduleCommit({ name, dimsCm: next, modelRotationDeg: rotation });
  }
  function handleRotationChange(next: ModelRotation) {
    setRotation(next);
    scheduleCommit({ name, dimsCm: dims, modelRotationDeg: next });
  }

  return (
    <div className="object-inspector">
      <header className="object-inspector-header">
        <p className="object-inspector-title">Edit "{item.name}"</p>
        <button type="button" className="object-inspector-close" aria-label="Close editor" onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      <ObjectEditFields
        name={name}
        onNameChange={handleNameChange}
        dims={dims}
        onDimsChange={handleDimsChange}
        rotation={rotation}
        onRotationChange={handleRotationChange}
        dimsAxes={dimsAxes}
      />
    </div>
  );
}
