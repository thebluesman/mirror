# DESIGN.md — visual language (adapted from getdesign.md/cohere)

Source: https://getdesign.md/cohere/design-md (independent extraction of Cohere's
public design patterns; not affiliated with Cohere). Adopted as the v1 UI's visual
language per Shyam's 2026-07-18 decision — "don't spend time on design language."

## 1. Color

**Brand & accent**
| Name | Hex | Role |
|---|---|---|
| Near-Black Primary | `#17171c` | Primary CTAs, dark chrome, deep UI cards |
| Deep Enterprise Green | `#003c33` | Dark feature/product bands |
| Dark Navy | `#071829` | Alternate dark band |
| Action Blue | `#1863dc` | Links, pagination accents |
| Coral | `#ff7759` | Editorial chips, active-state markers |

**Surface & text**
| Name | Hex | Role |
|---|---|---|
| Canvas | `#ffffff` | Dominant background |
| Soft Stone | `#eeece7` | Cards, warm neutral blocks |
| Ink | `#212121` | Body text |
| Hairline | `#d9d9dd` | Rules/dividers |
| Muted Slate | `#93939f` | Metadata, secondary labels |
| Body Muted | `#616161` | Secondary body text |
| Border Light | `#e5e7eb` | Light borders |
| Card Border | `#f2f2f2` | Card outlines |

**Form/state**
| Name | Hex | Role |
|---|---|---|
| Focus Blue | `#4c6ee6` | Focus rings |
| Form Focus (purple) | `#9b60aa` | Textfield focus outline |
| Error | `#b30000` | Error text/borders |

## 2. Typography

Font stack: `"Space Grotesk"` (display/body), `"Space Mono"` (mono/labels) — local
substitutes preserving Cohere's extracted scale.

| Token | Size / weight / line-height / tracking |
|---|---|
| hero-display | 96px / 400 / 1 / -1.92px |
| product-display | 72px / 400 / 1 / -1.44px |
| section-heading | 48px / 400 / 1.2 / -0.48px |
| card-heading | 32px / 400 / 1.2 / -0.32px |
| feature-heading | 24px / 400 / 1.3 / 0 |
| body-large | 18px / 400 / 1.4 / 0 |
| body | 16px / 400 / 1.5 / 0 |
| button | 14px / 500 / 1.71 / 0 |
| mono-label | 14px / 400 / 1.4 / 0.28px, uppercase |

## 3. Spacing scale

`2, 6, 8, 12, 16, 24, 32, 80` (px)

## 4. Radius scale

`xs 4px · sm 8px · md 16px · lg 22px · xl 30px · pill 32px`

## 5. Components

- **button-primary** — `#17171c` bg, white text, pill radius (32px), 12px/24px padding.
- **button-secondary** — transparent, underline, ink text.
- **button-pill-outline** — 1px ink border, transparent bg, pill radius — filter/tag use.
- **blog-filter-chip** — oversized coral outline chip, active state fills coral bg /
  primary text.
- **hero-photo-card** — rounded (22px) media panel, gradient/photo-led fill.
- **product-card** — soft-stone bg, 8px radius, hairline `<hr>` rule between blocks.
- **agent-console-card** — dark (primary) panel mockup: title + status chips + input row.
- **dark-feature-band** — full-bleed dark (deep-green/navy) rounded band, 3-panel grid.
- **form fields** — 1px `#808080` border, 4px radius, 12px padding; focus state = colored
  border + 2px glow ring (`box-shadow: 0 0 0 2px rgba(...,.65)`).
- **table** — hairline borders, soft-stone header row.
- **elevation** — no shadows; depth communicated via flat white / bordered / dark-field /
  gradient-media, not box-shadow blur.
- **info-tooltip** — new ground, not in the Cohere extraction, codified here per
  improvements-minor-fixes.md §18 (`InfoTip` component, 2026-07-22): a 16px Lucide
  `Info` icon (§6 inline size) after a form-field label; hover/focus reveals a
  near-black (`#17171c`) popover — canvas text, 4px radius (`--radius-xs`), 1px
  hairline (`#d9d9dd`) border, body copy at 11px, no shadow (flat, per this
  section's elevation rule). Replaces the native `title` attribute, which can't
  carry this design language. One component, reused wherever a control needs
  brief on-demand help copy — not a general popover system.

## 6. Icon sizing

Not part of the original Cohere extraction (`cohere/DESIGN.md` doesn't cover icons beyond
noting Cohere uses custom icon fonts/illustrations — see its "Icons" line under Typography
§Font Family) — this app's icons are `lucide-react`, so this is new ground, codified here
per Shyam's 2026-07-22 request rather than adapted from the source system.

Lucide icons are drawn on a 24×24 grid with a default 2px stroke: below ~16px the stroke
reads thick relative to the glyph and corners round off, so 16px is treated as a practical
legibility floor rather than scaling icons down to literally match text height. Two fixed
sizes, chosen by context rather than a computed ratio (matching this app's flat spacing/
radius scales — named steps, not a formula), landing on the low two rungs of the 16/20/24
step scale common to comparable systems (Material, GitHub Primer) rather than a bespoke
number:

| Context | Size | Token | Used when |
|---|---|---|---|
| Inline with text | 16px | `--icon-size-inline` | Icon sits beside a text label inside the same control (e.g. a pill button with icon+word, like "Lock all" or "Snapshot") |
| Standalone | 20px | `--icon-size-standalone` | Icon is the entire control, no adjacent label (icon-only buttons — rename, delete, close) |

- **Inline (16px):** the smallest step that keeps the 2px stroke crisp while still reading
  slightly larger than the cap-height of this app's 13–14px body/button text (§2) — the
  usual optical-balance pairing for a line icon next to text, not literal em-matching.
- **Standalone (20px):** icon-only buttons carry their entire meaning on the icon alone (no
  word to lean on), so they need to read clearly at a glance and offer a fair click target —
  this app's standalone icon buttons currently have near-zero button padding, so the icon is
  most of the hit area. One step up the same scale.
- **Composes with spacing, doesn't replace it:** the icon-to-text gap inside a pill button
  uses the existing `--space-8` token, unchanged — this section only fixes the icon's own
  size, not the layout around it.
- Lucide's `size` prop takes a number (px), not a CSS custom property, so call sites pass
  the literal `16`/`20` that mirrors `tokens.css`'s `--icon-size-inline`/
  `--icon-size-standalone` — same by-hand sync convention `tokens.css`'s header already
  documents for the rest of this file.

## 7. Manipulation-handle colors

Not part of the original Cohere extraction — the 3D viewport's rotate/elevate
handles (`Viewport.tsx`) are new ground, codified here per Shyam's 2026-07-22
review of `docs/proposals/handle-reskin.md` §5, the same "new ground, agent-
codified" precedent as §6's icon-sizing rule above.

The handles carry a four-state color language layered on top of §1's palette.
Idle and hover map onto the two accents already reserved for links/CTAs and
active-state markers; collision and locked stay purpose-built hexes chosen for
legibility as an always-on-top 3D overlay rather than snapped to the nearest
documented token — see the per-state notes below for why.

| State | Hex | Token | Used when |
|---|---|---|---|
| Idle / selection | `#1863dc` | Action Blue (§1) | A handle's resting color while its item is selected, not hovered, not colliding, not locked. |
| Hover / active | `#ff7759` | Coral (§1) | A handle brightens to this on pointer-hover — matches the app's existing hover-brighten idiom, and reuses Coral's documented "active-state marker" role (§1) for "you're about to grab this." |
| Collision | `#ff5c5c` | handle-only, not §1's Error | The selected item's footprint currently overlaps another item or a wall. Deliberately brighter than §1's documented Error `#b30000` — a dark Error red reads poorly as a `depthTest:false` overlay drawn on top of furniture; legibility wins over palette purity here. |
| Locked | `#ffc94f` | handle-only | The selected item (or "lock all") is locked. A warm amber distinct from both Action Blue and both reds, so "locked" reads as its own state, not a shade of collision or selection. |

Precedence when more than one state is true at once: **collision overrides
locked** (a physical overlap is worth surfacing even on a locked item, since
locking only guards against accidental drags, not against something already
placed on top of it) — enforced by `Viewport.tsx`'s `gestureAffordanceColor`.
Coral-hover and collision-red are never shown on the same handle at the same
instant in practice, since a hover is momentary and collision is checked on
every relevant mutation — but Coral is deliberately kept out of the
idle/selection role specifically so it never sits adjacent to the collision
red and reads as a near-miss of it.

All four states render with the same flat, unlit `MeshBasicMaterial` and
`depthTest:false`/late-`renderOrder` overlay treatment — no shadows, no lit
shading — the direct 3D read of §5's "elevation: no shadows; depth communicated
via flat fields" rule.

## 8. Responsive

| Breakpoint | Width | Behavior |
|---|---|---|
| Small mobile | <425px | single-column, compact nav |
| Mobile | 425–640px | hero/media stacks, form rows stack |
| Tablet | 768–1024px | 2-column cards begin |
| Desktop | 1024–1440px | full nav, 3-column grids |
| Large desktop | 1440–2560px | wide containers, large vertical rhythm |

## 9. Quick-reference palette (agent prompt guide)

`#17171c` primary · `#003c33` dark band · `#ffffff` canvas · `#eeece7` stone card ·
`#ff7759` editorial/active · `#1863dc` link

Rule of thumb from the source system: white canvas or a full dark band first, pill CTAs,
rounded media cards, no undocumented interaction variants.
