import { useEffect } from "react";
import { X } from "lucide-react";
import { SHORTCUTS, type ShortcutContext } from "../scene/shortcuts";
import "./ShortcutCheatsheet.css";

// Proposal: docs/proposals/keyboard-cheatsheet.md §4.2 (improvements-minor-
// fixes.md §3, approved 2026-07-22). The app's first modal/overlay — no
// existing precedent in DESIGN.md or the codebase to extend, so this stays
// deliberately plain: DESIGN.md's own tokens (canvas/ink colors, --radius-md,
// --space-*) applied to a centered card over a scrim, Escape-to-close,
// nothing fancier. Reads `SHORTCUTS` from src/scene/shortcuts.ts — the same
// table Viewport.tsx's onKeyDown matches keystrokes against — so this can't
// hand-duplicate a shortcut list that drifts from what's actually bound.

const CONTEXT_LABELS: Record<ShortcutContext, string> = {
  selection: "Selected item",
  walk: "Walk mode",
  global: "Global",
};

// Selection first — most likely relevant when this is opened mid-work on the
// room — then walk, then whole-app shortcuts.
const CONTEXT_ORDER: ShortcutContext[] = ["selection", "walk", "global"];

export function ShortcutCheatsheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Escape-to-close, window-level like App.tsx's undo listener (this is a
  // whole-app modal, not scoped to canvas focus) — only attached while open,
  // so it can't intercept Escape's other meaning (cancel an in-progress
  // gesture) when the cheatsheet isn't showing.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(evt: KeyboardEvent) {
      if (evt.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="shortcut-cheatsheet-scrim" onClick={onClose}>
      <div
        className="shortcut-cheatsheet-card"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shortcut-cheatsheet-header">
          <p className="shortcut-cheatsheet-title">Keyboard shortcuts</p>
          <button type="button" className="shortcut-cheatsheet-close" aria-label="Close" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        {CONTEXT_ORDER.map((context) => {
          const rows = SHORTCUTS.filter((s) => s.context === context);
          if (rows.length === 0) return null;
          return (
            <section key={context} className="shortcut-cheatsheet-group">
              <p className="shortcut-cheatsheet-group-title">{CONTEXT_LABELS[context]}</p>
              {rows.map((s) => (
                <div key={`${context}-${s.display}-${s.label}`} className="shortcut-cheatsheet-row">
                  <span className="shortcut-cheatsheet-key">{s.display}</span>
                  <span className="shortcut-cheatsheet-label">{s.label}</span>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
