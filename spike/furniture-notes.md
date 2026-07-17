# Furniture & Decor Details (for prompt enrichment)

Collected 2026-07-17 from Shyam's descriptions, product pages, and photos.
Feeds `prompt.txt` / `prompt-reverse.txt` for the re-run planned in OUTCOME.md.

## Swivel Chair — West Elm Cozy Swivel Chair (98×90)
- Round barrel-style swivel armchair, deep plush seat, fully upholstered, on a concealed
  round swivel base — the whole body reads as one soft rounded pod.
- Fabric (from Shyam's photo): charcoal/black-and-white flecked melange weave
  ("salt-and-pepper" chunky texture, reads dark grey overall).
- Layout note: now sits in the NW corner by the TV wall (Figma 493,324), no longer mid-room.

## Billy + Högadal Unit — custom IKEA configuration (160 wide × 30 deep)
- Two BILLY/HÖGADAL bookcases with doors, side by side (80×30×106 each):
  white frame, full-height **woven bamboo doors** (natural bamboo tone, clear lacquer,
  visible weave texture) — warm contrast against the white carcass.
- Below: two BILLY white rolling drawers on castors, sitting UNDER the bookcases
  (https://www.ikea.com/ae/en/p/billy-drawer-white-with-castors-20521693/).
- Total height of the stacked configuration: **~149 cm** (confirmed by Shyam).
- Product: https://www.ikea.com/ae/en/p/billy-hoegadal-bookcase-with-doors-white-s79572204/

## Dining Table — West Elm Modern Expandable (60–80"), unexpanded (153×92)
- White lacquer top, pecan-finish wood legs/frame. Currently unexpanded (~60" = 152 cm,
  matches the 153×92 Figma footprint).
- Reference images didn't come through; description above is per Shyam + product line.

## Bookshelf — no model name; described from photos (72×40)
(IMG_0455 / IMG_2369 / IMG_4263, ~/Downloads)
- Solid pine / natural light-wood open bookcase, 2 columns × 4 rows = 8 open cubbies,
  dark (near-black) back panels, short dark wood legs. Visible knots in the pine.
- Currently houses **only books** (colorful mixed spines, tightly packed). Ignore the
  plants/baskets/bottles in the photos — those are old.
- Height from photos ≈ 4 cubbies + base, roughly 150–160 cm (geometry.json currently says 180 — revisit).
- Layout note: moved from NW corner to south side near the sofa (Figma 816,662).

## Shoe Rack — IKEA STÄLL shoe cabinet (79×29×148)
- White, minimalist, 3 open shoe compartments stacked vertically, cut-out handles with
  metal edges, front legs only (leans to wall). Footprint matches Figma exactly; height
  is 148 (geometry.json currently says 100 — update).
- https://www.ikea.com/ae/en/p/staell-shoe-cabinet-with-3-compartments-white-50530262/

## Water Cooler — Panasonic SDM-WD3438BG (34×30)
- Bottom-loading freestanding water dispenser, black with stainless-steel finish,
  hot/cold/normal taps, bottle concealed in the base cabinet.
- https://www.amazon.ae/dp/B07YWWKR1X

## TV Stand — from Shyam's photos (188×39)
- Mid-century Scandinavian media unit: warm oak/ash top and frame, three flat white
  drawer/door fronts, open middle shelf (DVD player, PS4 visible), tapered round
  light-wood legs. NOT dark wood — current prompt's "low dark wooden TV stand" is wrong.
- On/around it: black center-channel speaker, Apple TV, woven seagrass basket, small
  black lava rock on a grey tray. Flanked by two tall black tower speakers (Samsung
  home-theater set) plus a black subwoofer on the right.

## TV — Samsung Frame TV, WHITE bezel, flush wall mount
- Mounted flush against the wall (no visible gap/mount), thin white frame bezel.
  Current prompt just says "wall-mounted Samsung Frame TV" — add white bezel + flush.

## Room shell — from apartment photo + walkthrough video (IMG_3406.MOV, Aug 2023)
- **Ceiling height ≈ 240 cm confirmed** (measured off the balcony door in the photo:
  door frame 477 px vs wall 536 px at the same column → ratio 1.124; door 210–220 cm
  → ceiling 236–247). geometry.json's 240 assumption stands.
- **West-wall correction: one opening is a full-height glass balcony door, not a
  window.** The other is a framed window. Both have charcoal/dark-grey aluminum frames.
  geometry.json currently models two sill-90 windows — update one to a glazed door
  (full height ~214 to frame top, ~26 cm wall above).
- Floors: large light greige/off-white porcelain tiles (~60×60) with matching skirting,
  slightly reflective. Walls warm white.
- Ceiling fixture: small 3-arm chandelier, curved brushed-metal arms, white glass
  tulip shades.
- Open kitchen (visible from living room): dark brown wood cabinet fronts, black
  granite countertops, glossy grey-veined tile splashback.
- View through the glazing: neighboring beige/cream apartment buildings, green trees,
  balcony with glass balustrade and silver handrail.

## Coffee Table — IKEA GUTTANE (116×39×32)
- Long, narrow, low bench-style table, solid oak with oak-veneer top, oil finish.
- In front of the sofa, ~35 cm gap, centered to the media console (x 629–745, z 535–574).
- https://www.ikea.com/ae/en/p/guttane-coffee-table-oak-10587712/

## Rug — IKEA SÖNDERÖD high pile, blue (240×170)
- Blue watercolor-stroke pattern, thick dense high pile (17 mm). Discontinued in UAE;
  reference: https://www.ikea.cn/cn/en/p/soenderoed-rug-high-pile-blue-80345847/
- Sofa sits on it; centered to the media console (x 567–807, z 532–702).

## Not yet re-described (carried from existing prompts)
- ÄPPLARYD sofa: L-shape with chaise, Lejde light grey (pinned in poc-plan.md).

## Before re-running generation
- The layout changed in Figma (swivel chair ↔ bookshelf swapped areas, Billy unit
  relabeled Hemnes → Högadal). `geometry.json`, `scene.html`, and both depth maps
  (`out/depth.png`, `out/depth-reverse.png`) reflect the OLD layout and must be
  regenerated first.
- Geometry corrections to apply at the same time: west wall = 1 window + 1 full-height
  glass balcony door (not 2 windows); Billy+Högadal h 202 → 149; shoe rack h 100 → 148;
  bookshelf h 180 → ~150–160.
