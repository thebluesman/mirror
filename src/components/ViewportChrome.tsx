import { useState } from "react";
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
}: {
  cameras: CameraPosition[];
  onRecall: (preset: CameraPosition) => void;
  /** Returns whether the save actually happened (false if the viewport isn't
   *  ready yet) — commitSave only clears/closes the form on success, so a
   *  failed save doesn't silently read as done. */
  onSave: (name: string) => boolean;
  onDelete: (id: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);

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

  return (
    <div className="viewport-chrome">
      <p className="viewport-chrome-hint">Drag to orbit · scroll to zoom · right-drag to pan</p>
      <div className="viewport-chrome-bar">
        {cameras.map((cam) => (
          <div key={cam.id} className="viewport-chrome-view">
            <button type="button" className="viewport-chrome-pill" onClick={() => onRecall(cam)}>
              {cam.name}
            </button>
            <button
              type="button"
              className="viewport-chrome-remove"
              aria-label={`Delete saved view "${cam.name}"`}
              onClick={() => onDelete(cam.id)}
            >
              ×
            </button>
          </div>
        ))}

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
