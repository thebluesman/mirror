import { useId, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import "./InfoTip.css";

// improvements-minor-fixes.md §18 / docs/proposals/shell-texture-preview.md
// §2 (built 2026-07-22), Option T-2: a small reusable on-brand replacement
// for the native `title` attribute, which can't carry the design language
// (browser-default styling, long hover delay, no touch support). Decided
// once here and reused wherever a control needs brief on-demand help copy —
// documented as the `info-tooltip` component in DESIGN.md §5, per that
// doc's "no undocumented interaction variants" rule.
//
// Hover *or* focus reveals `children` as the tooltip body — both are wired
// (not just :hover) so the Lucide `Info` icon is keyboard-reachable as a
// real focusable element, not decoration bolted onto unrelated text.
export function InfoTip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span className="info-tip">
      <button
        type="button"
        className="info-tip-trigger"
        aria-describedby={tooltipId}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Info size={16} aria-hidden="true" />
      </button>
      <span role="tooltip" id={tooltipId} className="info-tip-bubble" hidden={!open}>
        {children}
      </span>
    </span>
  );
}
