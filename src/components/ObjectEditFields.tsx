import type { Dims, ModelRotation } from "../schema/scene";
import "./ObjectEditFields.css";

// improvements-v2.2 §6: the field set shared by ImportPanel's pre-confirm
// stage and Viewport's post-import docked editor — "one editor component,
// two mounting contexts" (the improvements doc's own framing) rather than
// two hand-maintained copies of the same W/D/H + orientation-correction
// fields. Extracted from ImportPanel.tsx's former inline DimsConfirmForm
// JSX, which had no other caller before this.

const ROTATION_STEPS = [0, 90, 180, 270] as const;

// Code-review precedent carried over from ImportPanel.tsx's original
// DimsConfirmForm: `min={0.1}` on the number inputs is only an HTML hint —
// it doesn't stop a cleared/negative value from reaching onDimsChange
// (Number("") is 0, not NaN). A 0/negative/non-finite dim would fit a
// zero/mirrored/degenerate scale (fitModelToDims) and, since Dims has no
// positivity constraint at the schema level, persist that way with no
// in-app fix.
export function isValidDim(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/** True only when every axis of `dims` is a valid (finite, positive)
 *  number — the single check both mounting contexts use to gate their own
 *  "confirm"/"apply" affordance. */
export function dimsAreValid(dims: Dims): boolean {
  return isValidDim(dims.w) && isValidDim(dims.d) && isValidDim(dims.h);
}

export function ObjectEditFields({
  dims,
  onDimsChange,
  rotation,
  onRotationChange,
  name,
  onNameChange,
}: {
  dims: Dims;
  onDimsChange: (dims: Dims) => void;
  rotation: ModelRotation;
  onRotationChange: (rotation: ModelRotation) => void;
  /** Rendered only when both are given. ImportPanel's pre-confirm stage has
   *  no name field (it's set earlier, in the "pick" stage, before a photo is
   *  even generated); Viewport's post-import docked editor does — see
   *  ObjectInspector.tsx. */
  name?: string;
  onNameChange?: (name: string) => void;
}) {
  const invalid = (["w", "d", "h"] as const).filter((axis) => !isValidDim(dims[axis]));

  return (
    <div className="object-edit-fields">
      {name !== undefined && onNameChange && (
        <label className="object-edit-field">
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => onNameChange(e.target.value)} />
        </label>
      )}

      <div className="object-edit-row">
        {(["w", "d", "h"] as const).map((axis) => (
          <label key={axis} className="object-edit-field">
            <span>{axis.toUpperCase()}</span>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={dims[axis]}
              onChange={(e) => onDimsChange({ ...dims, [axis]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      {invalid.length > 0 && (
        <p className="object-edit-error">{invalid.map((a) => a.toUpperCase()).join(", ")} must be a positive number.</p>
      )}

      <div className="object-edit-row">
        {(["x", "y", "z"] as const).map((axis) => (
          <label key={axis} className="object-edit-field">
            <span>Rotate {axis.toUpperCase()}</span>
            <select
              value={rotation[axis]}
              onChange={(e) => onRotationChange({ ...rotation, [axis]: Number(e.target.value) })}
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
    </div>
  );
}
