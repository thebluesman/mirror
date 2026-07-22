# improvements-v2.1 — UI/UX/Polish

Post-v2 hardening batch. Not a versioned feature build like v1/v2 — no new
PRD, no spike. This is the first of several thought-groupings Shyam is
working through; more may follow as separate docs once this batch closes.
Measurement (v3) stays shelved — see 2026-07-22 journal entry.

## 0. Design-system compliance audit (do first)

The current UI has drifted from `DESIGN.md`. Before touching individual
items below, run a full audit of the live app against `DESIGN.md`, **and**
diff `DESIGN.md` itself against the live source (https://getdesign.md/cohere/design-md)
to confirm the extraction still holds. Report findings before fixing, in
case the gap is bigger than the items already known (see §1–§3).

Known gaps already spotted, to confirm/fix as part of this audit:

1. **Sidebar background.** `.app-panel` (`src/App.css:59`) uses
   `--color-soft-stone` for the whole panel. Per `DESIGN.md` §1/§5, soft
   stone is a *card* surface (`product-card`), not the dominant background —
   canvas (`#ffffff`) is. Sidebar shell should be canvas; reserve soft-stone
   for actual card/block surfaces within it, per whatever card taxonomy the
   audit recommends (§5's `product-card` / hairline-rule pattern is the
   existing candidate).
2. **Typography not actually loading.** `tokens.css` declares
   `--font-display: "Space Grotesk"` / `--font-mono: "Space Mono"`, but
   nothing loads the font files — no `@font-face`, no local asset — so the
   app silently falls back to system fonts. Fix: self-host both fonts
   (woff2, bundled as local assets — no CDN/network call, consistent with
   the browser-only/fal.ai-only-network-call rule) and verify rendered
   output actually matches `tokens.css`'s type scale.
3. **No icon library.** HUD buttons (layouts/views, `ViewportChrome.tsx`)
   currently break when rendering icons (see §2 below) — there's no
   consistent icon system in place. Adopt **Lucide** (React components,
   bundled — no runtime network fetch) as the icon library across the app.

## 1. Sidebar width — fix the root cause, not the symptom

Sidebar width visibly changes across tabs. Root cause: `.app-panel` sets
`flex: 0 0 320px` but not `min-width: 0` — flex children default to
`min-width: auto`, so any tab whose content (filenames, buttons, etc.) is
wider than 320px forces the container to grow instead of clipping/wrapping.

Fix as a systemic contract, not a per-tab patch:
- Pin sidebar width via a token (e.g. `--sidebar-width`, 320px).
- Set `min-width: 0` on `.app-panel` so it structurally cannot grow past
  that width regardless of child content.
- Push overflow-handling (truncate, wrap, internal scroll) down into
  whichever panel content needs it.

This guarantees new tabs added later can't reintroduce the bug.

## 2. HUD button icon breakage

Layout/view HUD buttons (`ViewportChrome.tsx`) break when they contain
icons. Fix as part of the Lucide adoption in §0.3 — likely resolves itself
once icons are real SVG components instead of whatever's causing the
current breakage (confirm root cause during audit, don't just paper over
it).

## 3. Object outline / manipulation handles — refinement

Outline colors are fine as-is; the manipulation affordance is the problem.

- Current spherical rotate handle is not intuitive.
- Add discrete drag handles for horizontal and vertical translation
  (separate from rotate), if feasible given the existing floor-plane-drag +
  elevation-scalar model (`src/scene/elevation.ts`, `rotateHandle.ts`).
  Scope this against what the current input model can actually support
  before committing to a specific handle design.
- **Explicitly no scaling handle** — out of scope, not wanted.
- Before implementing, research how existing 3D planning/design tools
  (room planners, CAD/modeling packages, etc.) handle object
  selection/manipulation affordances, and bring back concrete suggestions
  rather than a single fixed design. Any proposed handle/affordance style
  must still conform to `DESIGN.md` (colors, radius/spacing tokens, no
  undocumented interaction variants per §7's rule of thumb) — this is a
  research-and-propose step, not a license to freelance the visual
  language.

## 4. Lock object placement

Add a way to lock an item's placement (per-item, and/or a global toggle) so
it can't be accidentally dragged while orbiting the camera. Likely a flag
gating drag-start in the existing selection/drag handling
(`src/scene/commit.ts`, `Viewport.tsx`).

## 5. FPS-style room navigation

Add a walk-around camera mode (WASD + mouselook) alongside the existing
orbit camera, rather than replacing it. This is a real feature, not a
polish item — scope and estimate accordingly; flag if it meaningfully
affects camera-viewpoint save/restore (`cameraViewpoints.ts`).

## 6. Import project from a zip

Symmetric with the existing zip export (Settings panel). Should be
low-effort since the export zip format is already defined — build the
inverse: pick a zip, validate/parse it, load it as the active project.

## Sequencing note

§0 (audit) should land first since it may reshape or fold in §1–§2 as
findings come back, not run as a fully separate track after them. §3–§6
are independent of §0/§1/§2 and of each other.
