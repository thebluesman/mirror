import { useState } from "react";
import { Camera, Lock, LockOpen, Pencil, Plus, X } from "lucide-react";
import type { CameraPosition } from "../schema/scene";
import { LENS_PRESETS, type LensPresetId } from "../scene/cameraLens";
import "./ViewportChrome.css";

// Floating viewport chrome (PRD §9: "built from DESIGN.md's existing tokens
// — near-black floating control bar, pill buttons — not a new system") for
// Phase 5's named-viewpoint save/recall (plan-v1.md Phase 5 item 1).
//
// Icon sizes below follow DESIGN.md §6: 16 for icon+label pills (inline),
// 20 for icon-only buttons (standalone) — mirrors tokens.css's
// --icon-size-inline/--icon-size-standalone.

export function ViewportChrome({
  cameras,
  onRecall,
  onSave,
  onDelete,
  onRename,
  lockAllActive,
  onToggleGlobalLock,
  onSnapshot,
  onOpenShortcuts,
  lensPreset,
  onSetLensPreset,
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
  /** improvements-v2.1 §4 / improvements-minor-fixes.md §3 (review round):
   *  "lock all" safety toggle's PRESSED/label state. Deliberately NOT just
   *  App.tsx's raw `globalLock` flag anymore — that flag alone can go stale
   *  if items end up individually locked via the per-item `L` key,
   *  independent of this button (the flag stays false, but every item is
   *  genuinely locked). App.tsx now derives this as
   *  `globalLock || everyItemIsLocked`, so the button reflects the real
   *  aggregate lock state regardless of how items got there. */
  lockAllActive: boolean;
  onToggleGlobalLock: () => void;
  /** improvements-v2.2 §8: downloads the current camera POV as a PNG.
   *  Fire-and-forget like onDelete/onRename — App.tsx no-ops silently if the
   *  viewport isn't ready yet (mirrors captureSnapshot's null-guard). */
  onSnapshot: () => void;
  /** improvements-minor-fixes.md §3: opens the `?` keyboard-shortcuts
   *  overlay (ShortcutCheatsheet, rendered by App.tsx — this pill only
   *  triggers it, same "fire a callback, don't own the modal" shape as
   *  every other action in this bar). */
  onOpenShortcuts: () => void;
  /** improvements-minor-fixes.md §17: live lens picker's active preset —
   *  `null` means "Custom" (no pill highlighted), e.g. right after recalling
   *  a saved viewpoint whose own `fovDeg` doesn't match any of the three
   *  named presets. See docs/proposals/camera-lens-picker.md §3. */
  lensPreset: LensPresetId | null;
  onSetLensPreset: (id: LensPresetId) => void;
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
          className={`viewport-chrome-pill viewport-chrome-lock${lockAllActive ? " viewport-chrome-lock--active" : ""}`}
          onClick={onToggleGlobalLock}
          aria-pressed={lockAllActive}
          title={lockAllActive ? "Unlock all items (drag/rotate/elevate re-enabled)" : "Lock all items (prevent accidental drag/rotate/elevate)"}
        >
          {lockAllActive ? <Lock size={16} aria-hidden="true" /> : <LockOpen size={16} aria-hidden="true" />}
          {lockAllActive ? "All locked" : "Lock all"}
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
          <Camera size={16} aria-hidden="true" />
          Snapshot
        </button>
        {/* improvements-minor-fixes.md §17: live lens picker — Wide/Normal/
         *  Tele 35mm-equivalent focal-length presets for the *live*
         *  orbit/walk camera, independent of any saved viewpoint. Labels are
         *  focal length ONLY — never a degree value (Shyam's correction to
         *  the original proposal's FOV-degree table, see
         *  docs/proposals/camera-lens-picker.md). One grouped pill (three
         *  mutually exclusive states of one control), not three standalone
         *  action pills like Snapshot. */}
        <div className="viewport-chrome-lens" role="group" aria-label="Camera lens">
          {LENS_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`viewport-chrome-lens-option${lensPreset === preset.id ? " viewport-chrome-lens-option--active" : ""}`}
              onClick={() => onSetLensPreset(preset.id)}
              aria-pressed={lensPreset === preset.id}
              title={`${preset.label} — ${preset.focalLengthLabel}`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {/* improvements-minor-fixes.md §3: one-click keyboard-shortcuts
         *  cheatsheet — a `?` pill matching the existing pill visual
         *  language, per docs/proposals/keyboard-cheatsheet.md §4.1. Stays
         *  in this bottom-center bar, no new HUD position. */}
        <button
          type="button"
          className="viewport-chrome-pill"
          onClick={onOpenShortcuts}
          title="Keyboard shortcuts"
          aria-label="Show keyboard shortcuts"
        >
          ?
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
              <button type="button" className="viewport-chrome-pill viewport-chrome-pill--nested" onClick={() => onRecall(cam)}>
                {cam.name}
              </button>
              <button
                type="button"
                className="viewport-chrome-rename"
                aria-label={`Rename saved view "${cam.name}"`}
                onClick={() => startRename(cam)}
              >
                <Pencil size={20} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="viewport-chrome-remove"
                aria-label={`Delete saved view "${cam.name}"`}
                onClick={() => onDelete(cam.id)}
              >
                <X size={20} aria-hidden="true" />
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
            <Plus size={16} aria-hidden="true" />
            Save view
          </button>
        )}
      </div>
    </div>
  );
}
