import { useState } from "react";
import { Camera, Lock, LockOpen, Pencil, X } from "lucide-react";
import type { CameraPosition } from "../schema/scene";
import "./ViewportChrome.css";

// Floating viewport chrome (PRD §9: "built from DESIGN.md's existing tokens
// — near-black floating control bar, pill buttons — not a new system") for
// Phase 5's named-viewpoint save/recall (plan-v1.md Phase 5 item 1).

export function ViewportChrome({
  cameras,
  onRecall,
  onSave,
  onDelete,
  onRename,
  globalLock,
  onToggleGlobalLock,
  onSnapshot,
}: {
  cameras: CameraPosition[];
  onRecall: (preset: CameraPosition) => void;
  /** Returns whether the save actually happened (false if the viewport isn't
   *  ready yet) — commitSave only clears/closes the form on success, so a
   *  failed save doesn't silently read as done. */
  onSave: (name: string) => boolean;
  onDelete: (id: string) => void;
  /** In-place rename (PRD-v2 §7.2) — id/eye/lookAt/fovDeg are untouched, only
   *  the display name changes. Unlike onSave, there's no failure mode worth
   *  surfacing here, so this is fire-and-forget like onDelete. */
  onRename: (id: string, name: string) => void;
  /** improvements-v2.1 §4: "lock all" safety toggle — when on, no item can
   *  be dragged/rotated/elevated regardless of its own `locked` flag.
   *  Ephemeral (App.tsx state, not sceneFile), so this pill reflects it the
   *  same way the rest of this bar reflects live view state, not persisted
   *  scene data. */
  globalLock: boolean;
  onToggleGlobalLock: () => void;
  /** improvements-v2.2 §8: downloads the current camera POV as a PNG.
   *  Fire-and-forget like onDelete/onRename — App.tsx no-ops silently if the
   *  viewport isn't ready yet (mirrors captureSnapshot's null-guard). */
  onSnapshot: () => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function commitSave() {
    const trimmed = name.trim();
    const saved = onSave(trimmed || `View ${cameras.length + 1}`);
    if (saved) {
      setName("");
      setNaming(false);
      setSaveFailed(false);
    } else {
      setSaveFailed(true);
    }
  }

  function startRename(cam: CameraPosition) {
    setRenamingId(cam.id);
    setRenameValue(cam.name);
  }

  function commitRename() {
    if (renamingId) onRename(renamingId, renameValue);
    setRenamingId(null);
    setRenameValue("");
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
  }

  return (
    <div className="viewport-chrome">
      <p className="viewport-chrome-hint">Drag to orbit · scroll to zoom · right-drag to pan</p>
      <div className="viewport-chrome-bar">
        {/* improvements-v2.1 §4: global "lock all" — a safety toggle, not a
         *  saved-view/layout op, so it sits apart from the rest of the bar's
         *  content rather than inline with the cameras list it happens to
         *  share a pill-button visual language with. */}
        <button
          type="button"
          className={`viewport-chrome-pill viewport-chrome-lock${globalLock ? " viewport-chrome-lock--active" : ""}`}
          onClick={onToggleGlobalLock}
          aria-pressed={globalLock}
          title={globalLock ? "Unlock all items (drag/rotate/elevate re-enabled)" : "Lock all items (prevent accidental drag/rotate/elevate)"}
        >
          {globalLock ? <Lock size={13} aria-hidden="true" /> : <LockOpen size={13} aria-hidden="true" />}
          {globalLock ? "All locked" : "Lock all"}
        </button>
        {/* improvements-v2.2 §8: one-click download of the current camera
         *  POV as a PNG — sits beside the lock pill for the same reason
         *  (a standalone viewport action, not a saved-view list item). */}
        <button
          type="button"
          className="viewport-chrome-pill"
          onClick={onSnapshot}
          title="Download a PNG of the current view"
        >
          <Camera size={13} aria-hidden="true" />
          Snapshot
        </button>
        {cameras.map((cam) =>
          renamingId === cam.id ? (
            <form
              key={cam.id}
              className="viewport-chrome-naming"
              onSubmit={(e) => {
                e.preventDefault();
                commitRename();
              }}
            >
              <input
                type="text"
                autoFocus
                className="viewport-chrome-naming-input"
                aria-label={`Rename saved view "${cam.name}"`}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelRename();
                }}
              />
              <button type="submit" className="viewport-chrome-pill viewport-chrome-pill--outline">
                Save
              </button>
            </form>
          ) : (
            <div key={cam.id} className="viewport-chrome-view">
              <button type="button" className="viewport-chrome-pill" onClick={() => onRecall(cam)}>
                {cam.name}
              </button>
              <button
                type="button"
                className="viewport-chrome-rename"
                aria-label={`Rename saved view "${cam.name}"`}
                onClick={() => startRename(cam)}
              >
                <Pencil size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="viewport-chrome-remove"
                aria-label={`Delete saved view "${cam.name}"`}
                onClick={() => onDelete(cam.id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ),
        )}

        {naming ? (
          <form
            className="viewport-chrome-naming"
            onSubmit={(e) => {
              e.preventDefault();
              commitSave();
            }}
          >
            <input
              type="text"
              autoFocus
              className="viewport-chrome-naming-input"
              placeholder="View name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setNaming(false);
                  setName("");
                  setSaveFailed(false);
                }
              }}
            />
            <button type="submit" className="viewport-chrome-pill viewport-chrome-pill--outline">
              Save
            </button>
            {saveFailed && <span className="viewport-chrome-naming-error">Viewport not ready — try again</span>}
          </form>
        ) : (
          <button
            type="button"
            className="viewport-chrome-pill viewport-chrome-pill--outline"
            onClick={() => setNaming(true)}
          >
            + Save view
          </button>
        )}
      </div>
    </div>
  );
}
