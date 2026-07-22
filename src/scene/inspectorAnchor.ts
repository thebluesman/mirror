// docs/proposals/object-inspector-anchor.md §11: pure below → above →
// nearest-side → clamp anchor math for docking ObjectInspector's floating
// `.object-inspector-wrap` to the selected item's on-screen bounding rect.
// Framework-free (no THREE/DOM reads) — same "pure algorithm, unit-testable
// without a WebGL context" shape as src/scene/collision.ts. Viewport.tsx's
// animate() loop does the THREE.Vector3.project() work to produce `objRect`
// and hands this module plain numbers; see Viewport.tsx's
// `updateInspectorAnchor` for the call site.

/** A rectangle in container-pixel space (not NDC) — top-left origin, y down,
 *  matching `getBoundingClientRect()`/CSS `left`/`top` conventions. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AnchorPoint {
  left: number;
  top: number;
}

/** True if `rect` overlaps the container's own `[0, width] x [0, height]`
 *  box at all. Used to detect "the selected item is fully off-screen" so
 *  Viewport.tsx can skip the anchor rule entirely and fall back to the
 *  fixed corner (see `fixedCornerAnchor` below) — a separate concern from
 *  the fit-check math `computeInspectorAnchor` does, kept as its own
 *  function so both are independently testable. */
export function rectOverlapsViewport(rect: ScreenRect, containerWidth: number, containerHeight: number): boolean {
  return rect.left < containerWidth && rect.right > 0 && rect.top < containerHeight && rect.bottom > 0;
}

/** Clamp one axis of the panel's position into
 *  `[margin, containerSize - panelSize - margin]` — proposal §1 step 4, the
 *  backstop that makes "goes off-screen" impossible regardless of what
 *  steps 1–3 produced. If the panel doesn't fit even with zero margin (a
 *  pathologically small viewport, or a panel wider/taller than the
 *  container), pins to `margin` rather than producing an inverted range. */
function clampAxis(value: number, panelSize: number, containerSize: number, margin: number): number {
  const max = containerSize - panelSize - margin;
  if (max < margin) return margin;
  return Math.min(Math.max(value, margin), max);
}

/** Proposal §1's anchor rule, evaluated in order — below, then above, then
 *  the nearest free side, then clamped (step 4, always applied, is what
 *  makes the earlier three steps safe to compute without their own bounds
 *  checking). `objRect` is the selected item's projected on-screen bounding
 *  box; `panelWidth`/`panelHeight` the anchored wrap's current rendered
 *  size (hint pill + gap + card — see Viewport.css's
 *  `.object-inspector-wrap`); `gap` the object-to-panel spacing
 *  (`--space-16`); `margin` the viewport-edge clamp inset (`--space-24`). */
export function computeInspectorAnchor(
  objRect: ScreenRect,
  panelWidth: number,
  panelHeight: number,
  containerWidth: number,
  containerHeight: number,
  gap: number,
  margin: number,
): AnchorPoint {
  const centerX = (objRect.left + objRect.right) / 2;
  const fitsBelow = objRect.bottom + gap + panelHeight + margin <= containerHeight;
  const fitsAbove = objRect.top - gap - panelHeight - margin >= 0;

  let left: number;
  let top: number;
  if (fitsBelow) {
    left = centerX - panelWidth / 2;
    top = objRect.bottom + gap;
  } else if (fitsAbove) {
    left = centerX - panelWidth / 2;
    top = objRect.top - gap - panelHeight;
  } else {
    // Nearest side: the object's on-screen box is tall enough to fill most
    // of the viewport (a close camera, or a floor-to-ceiling item) — put
    // the panel on whichever side has more free room, i.e. the side
    // opposite the half of the container the object's center falls in.
    const onLeftHalf = centerX < containerWidth / 2;
    left = onLeftHalf ? objRect.right + gap : objRect.left - gap - panelWidth;
    top = (objRect.top + objRect.bottom) / 2 - panelHeight / 2;
  }

  return {
    left: clampAxis(left, panelWidth, containerWidth, margin),
    top: clampAxis(top, panelHeight, containerHeight, margin),
  };
}

/** The pre-anchor-system fixed corner
 *  (`ObjectInspector.css`'s original `left: var(--space-24); bottom:
 *  var(--space-24)`, later inherited by `.object-inspector-wrap`) —
 *  proposal §1's edge-case fallback for when the selected item is behind
 *  the camera or fully off-screen ("object not currently visible" degrades
 *  to exactly today's behavior instead of a new edge case to design").
 *  Expressed in left/top terms (not left/bottom) since the imperative path
 *  always writes `left`/`top` — see Viewport.tsx's `updateInspectorAnchor`. */
export function fixedCornerAnchor(panelHeight: number, containerHeight: number, margin: number): AnchorPoint {
  return { left: margin, top: containerHeight - panelHeight - margin };
}
