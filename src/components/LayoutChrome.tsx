import { useState } from "react";
import type { Layout } from "../schema/scene";
import "./ViewportChrome.css";
import "./LayoutChrome.css";

// D3 (v2 spike, W-A persistence): named layouts save/switch, same floating-
// pill pattern ViewportChrome (Phase 5) established for camera viewpoints —
// reuses its CSS classes with a `--top` position override (`LayoutChrome.css`)
// so the two chromes don't collide in the same bottom-center spot.

export function LayoutChrome({
  layouts,
  currentId,
  onSwitch,
  onSave,
  onDelete,
}: {
  layouts: Layout[];
  currentId: string;
  onSwitch: (id: string) => void;
  /** Returns whether the save actually happened (false if there's no current
   *  layout to snapshot from) — same success-gated pattern ViewportChrome's
   *  onSave uses, so a failed save doesn't silently close the naming form. */
  onSave: (name: string) => boolean;
  onDelete: (id: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);

  function commitSave() {
    const trimmed = name.trim();
    const saved = onSave(trimmed || `Layout ${layouts.length + 1}`);
    if (saved) {
      setName("");
      setNaming(false);
      setSaveFailed(false);
    } else {
      setSaveFailed(true);
    }
  }

  return (
    <div className="viewport-chrome viewport-chrome--top">
      <div className="viewport-chrome-bar">
        {layouts.map((layout) => (
          <div key={layout.id} className="viewport-chrome-view">
            <button
              type="button"
              className={`viewport-chrome-pill${layout.id === currentId ? " viewport-chrome-pill--active" : ""}`}
              onClick={() => onSwitch(layout.id)}
            >
              {layout.name}
            </button>
            {/* Deleting the only remaining layout, or the one currently in
             *  view, would leave sceneFile.current pointing at nothing —
             *  guarded here (disabled) rather than in the handler, so the
             *  reason is visible instead of a silent no-op click. */}
            {layouts.length > 1 && layout.id !== currentId && (
              <button
                type="button"
                className="viewport-chrome-remove"
                aria-label={`Delete layout "${layout.name}"`}
                onClick={() => onDelete(layout.id)}
              >
                ×
              </button>
            )}
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
              placeholder="Layout name"
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
              Save as new
            </button>
            {saveFailed && <span className="viewport-chrome-naming-error">Couldn't save — try again</span>}
          </form>
        ) : (
          <button
            type="button"
            className="viewport-chrome-pill viewport-chrome-pill--outline"
            onClick={() => setNaming(true)}
          >
            + Save layout
          </button>
        )}
      </div>
    </div>
  );
}
