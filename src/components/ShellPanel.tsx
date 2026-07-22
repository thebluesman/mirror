import { useEffect, useId, useReducer, useRef, useState } from "react";
import {
  DEFAULT_SURFACE_CALIBRATION,
  type ShellCalibration,
  type SurfaceCalibration,
} from "../schema/scene";
import { photoToTileableBlob } from "../texturing/pipeline";
import { putAsset } from "../storage/assets";
import { useDebouncedCallback } from "../util/useDebouncedCallback";
import { InfoTip } from "./InfoTip";
import { ShellTexturePreview3D } from "./ShellTexturePreview3D";
import "./ShellPanel.css";

// Range inputs fire `onChange` on every pixel of drag — without debouncing,
// that meant one Viewport calibration-effect run (potentially a full
// texture reload+reapply) per mouse-move event (code review finding).
// 120ms lands comfortably under "feels instant" for a drag gesture while
// collapsing a whole drag into a handful of commits.
const SLIDER_DEBOUNCE_MS = 120;

const SURFACES: Array<{ key: "wall" | "floor" | "ceiling"; label: string }> = [
  { key: "wall", label: "Wall" },
  { key: "floor", label: "Floor" },
  { key: "ceiling", label: "Ceiling" },
];

// docs/proposals/shell-texture-preview.md §1.2 (improvements-minor-fixes.md
// §18, built 2026-07-22) — narrow-draft Option P-2, overriding the
// proposal's own recommended P-1 (2026-07-22 review correction). P-2 means
// the preview gates only the newly-uploaded *photo*: it renders at the
// surface's CURRENT committed repeat/roughness/tint, and the Repeat X/Y/
// Roughness sliders below are completely untouched by this state
// machine — they keep editing the live surface exactly as before, with no
// preview involvement. That's what keeps this a `handleFile`-only change.
//
//   idle ──(pick file)──► processing ──(blob ready)──► preview ──(Confirm)──► committing ──(committed)──► idle
//                              │                            │                      │
//                              └─(throw)─► error             └─(Cancel)──► idle      └─(throw)─► error
//
// `putAsset` (the OPFS write) and `onChange` (the live-room commit) both
// happen only on the preview → committing transition — never on file pick —
// so a cancelled preview leaves no orphan content-addressed asset and never
// touches the live shell (proposal §1.2 "Key differences from today").
export type SurfaceRowState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "preview"; draftBlob: Blob }
  | { status: "committing"; draftBlob: Blob }
  | { status: "error" };

export type SurfaceRowAction =
  | { type: "pickFile" }
  | { type: "blobReady"; blob: Blob }
  | { type: "pipelineError" }
  | { type: "confirm" }
  | { type: "committed" }
  | { type: "commitError" }
  | { type: "cancel" };

/** Pure state machine for SurfaceRow's upload → preview → confirm/cancel →
 *  commit cycle (see the diagram above). Each transition is guarded by the
 *  *current* status, not just the action type, so an action that doesn't
 *  apply to the current state (e.g. a stray "cancel" while idle) is a
 *  no-op rather than a state-machine violation — kept as a small pure
 *  function, exported directly like ObjectEditFields.tsx's `dimsAreValid`,
 *  so the transition logic is unit-testable without rendering React or
 *  touching the (browser-only) tileable-texture pipeline. */
export function surfaceRowReducer(state: SurfaceRowState, action: SurfaceRowAction): SurfaceRowState {
  switch (action.type) {
    case "pickFile":
      return { status: "processing" };
    case "blobReady":
      return state.status === "processing" ? { status: "preview", draftBlob: action.blob } : state;
    case "pipelineError":
      return state.status === "processing" ? { status: "error" } : state;
    case "confirm":
      return state.status === "preview" ? { status: "committing", draftBlob: state.draftBlob } : state;
    case "committed":
      return state.status === "committing" ? { status: "idle" } : state;
    case "commitError":
      return state.status === "committing" ? { status: "error" } : state;
    case "cancel":
      return state.status === "preview" ? { status: "idle" } : state;
    default:
      return state;
  }
}

interface SurfaceRowProps {
  surface: "wall" | "floor" | "ceiling";
  label: string;
  calib: SurfaceCalibration;
  onChange: (calib: SurfaceCalibration) => void;
}

function SurfaceRow({ surface, label, calib, onChange }: SurfaceRowProps) {
  const [rowState, dispatch] = useReducer(surfaceRowReducer, { status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  // Unique per SurfaceRow instance (ShellPanel renders one per wall/floor/
  // ceiling) so the Repeat X/Y/Roughness <label for> ids below don't
  // collide across rows.
  const fieldIdPrefix = useId();

  // Local mirror of `calib` for instant slider/label feedback while
  // dragging — `onChange` itself is debounced (see below) because it drives
  // Viewport's calibration effect (storage write + possible texture
  // reload), which must not run once per pixel of drag (code review
  // finding). Synced from the prop on every change so an external update
  // (e.g. a fresh upload elsewhere, or the initial load) still shows. Also
  // what the P-2 preview reads as "the surface's current committed
  // repeat/roughness/tint" (proposal §1.2) — it's the freshest value the
  // row is showing, including an in-flight drag not yet committed.
  const [liveCalib, setLiveCalib] = useState(calib);
  useEffect(() => setLiveCalib(calib), [calib]);
  const debouncedOnChange = useDebouncedCallback(onChange, SLIDER_DEBOUNCE_MS);

  function handleSliderChange(next: SurfaceCalibration) {
    setLiveCalib(next); // immediate visual feedback
    debouncedOnChange(next); // throttled commit
  }

  async function handleFile(file: File) {
    dispatch({ type: "pickFile" });
    try {
      const tileable = await photoToTileableBlob(file);
      // Held only in local reducer state until Confirm — no putAsset, no
      // onChange yet (proposal §1.2's "Key differences from today").
      dispatch({ type: "blobReady", blob: tileable });
    } catch (err) {
      console.error("[ShellPanel] tileable-texture pipeline failed", err);
      dispatch({ type: "pipelineError" });
    }
  }

  async function handleConfirm() {
    if (rowState.status !== "preview") return;
    const { draftBlob } = rowState;
    dispatch({ type: "confirm" });
    try {
      const hash = await putAsset(draftBlob);
      const next = { ...calib, assetHash: hash };
      setLiveCalib(next);
      onChange(next); // a confirmed photo is a one-shot event, not a drag — commit immediately
      dispatch({ type: "committed" });
    } catch (err) {
      console.error("[ShellPanel] failed to store confirmed texture", err);
      dispatch({ type: "commitError" });
    }
  }

  function handleCancel() {
    // Prior committed state is completely untouched — nothing to undo, the
    // draft blob was never written to OPFS or passed to onChange.
    dispatch({ type: "cancel" });
  }

  const isPreviewing = rowState.status === "preview" || rowState.status === "committing";
  const showUploadButton = !isPreviewing;

  return (
    <section className="shell-row">
      <header className="shell-row-header">
        <span className="shell-row-title">{label}</span>
        <span className={`shell-row-status shell-row-status--${calib.assetHash ? "photo" : "none"}`}>
          {calib.assetHash ? "photo applied" : "procedural"}
        </span>
      </header>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="shell-row-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      {showUploadButton && (
        <button
          type="button"
          className="shell-row-upload-button"
          onClick={() => inputRef.current?.click()}
          disabled={rowState.status === "processing"}
        >
          {rowState.status === "processing" ? "Processing…" : calib.assetHash ? "Replace photo" : "Upload photo"}
        </button>
      )}
      {rowState.status === "error" && <p className="shell-row-error">Couldn't process that photo — try another.</p>}

      {isPreviewing && (
        <div className="shell-row-preview-card">
          <ShellTexturePreview3D
            blob={rowState.draftBlob}
            surface={surface}
            repeat={liveCalib.repeat}
            roughnessScale={liveCalib.roughnessScale}
            tint={liveCalib.tint}
          />
          <p className="shell-row-preview-hint">
            Previewing at this surface's current repeat/roughness/tint — the sliders below won't change this
            preview until you confirm.
          </p>
          <div className="shell-row-preview-actions">
            <button
              type="button"
              className="shell-row-upload-button"
              onClick={() => void handleConfirm()}
              disabled={rowState.status === "committing"}
            >
              {rowState.status === "committing" ? "Saving…" : "Confirm"}
            </button>
            <button
              type="button"
              className="shell-row-cancel-button"
              onClick={handleCancel}
              disabled={rowState.status === "committing"}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <label className="shell-row-field">
        <span>Tint</span>
        <input
          type="color"
          value={liveCalib.tint}
          onChange={(e) => handleSliderChange({ ...liveCalib, tint: e.target.value })}
        />
      </label>

      <div className="shell-row-field">
        <div className="shell-row-field-label">
          <label htmlFor={`${fieldIdPrefix}-repeat-x`}>Repeat X ({liveCalib.repeat[0].toFixed(2)}×)</label>
          <InfoTip>
            How many times the texture repeats left-to-right across this surface. Raise it for smaller, tighter
            tiles; lower it for larger, more zoomed-in tiles.
          </InfoTip>
        </div>
        <input
          id={`${fieldIdPrefix}-repeat-x`}
          type="range"
          min={0.25}
          max={4}
          step={0.05}
          value={liveCalib.repeat[0]}
          onChange={(e) =>
            handleSliderChange({ ...liveCalib, repeat: [Number(e.target.value), liveCalib.repeat[1]] })
          }
        />
      </div>

      <div className="shell-row-field">
        <div className="shell-row-field-label">
          <label htmlFor={`${fieldIdPrefix}-repeat-y`}>Repeat Y ({liveCalib.repeat[1].toFixed(2)}×)</label>
          <InfoTip>
            How many times the texture repeats top-to-bottom across this surface. Raise it for smaller, tighter
            tiles; lower it for larger, more zoomed-in tiles.
          </InfoTip>
        </div>
        <input
          id={`${fieldIdPrefix}-repeat-y`}
          type="range"
          min={0.25}
          max={4}
          step={0.05}
          value={liveCalib.repeat[1]}
          onChange={(e) =>
            handleSliderChange({ ...liveCalib, repeat: [liveCalib.repeat[0], Number(e.target.value)] })
          }
        />
      </div>

      <div className="shell-row-field">
        <div className="shell-row-field-label">
          <label htmlFor={`${fieldIdPrefix}-roughness`}>
            Roughness ({liveCalib.roughnessScale.toFixed(2)}×)
          </label>
          <InfoTip>
            Scales how matte or glossy the surface looks under light. Above 1× reads flatter and more matte; below
            1× reads smoother and more reflective.
          </InfoTip>
        </div>
        <input
          id={`${fieldIdPrefix}-roughness`}
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={liveCalib.roughnessScale}
          onChange={(e) => handleSliderChange({ ...liveCalib, roughnessScale: Number(e.target.value) })}
        />
      </div>
    </section>
  );
}

export function ShellPanel({
  shell,
  onUpdateSurface,
}: {
  shell: ShellCalibration | undefined;
  onUpdateSurface: (surface: "wall" | "floor" | "ceiling", calib: SurfaceCalibration) => void;
}) {
  return (
    <div className="shell-panel">
      <h2 className="shell-panel-title">Shell texturing</h2>
      <p className="shell-panel-hint">
        Upload a straight-on, evenly-lit photo of each surface. It's turned into a tileable
        texture automatically — use the sliders below to calibrate against your real room.
      </p>
      {SURFACES.map(({ key, label }) => (
        <SurfaceRow
          key={key}
          surface={key}
          label={label}
          calib={shell?.[key] ?? DEFAULT_SURFACE_CALIBRATION}
          onChange={(calib) => onUpdateSurface(key, calib)}
        />
      ))}
    </div>
  );
}
