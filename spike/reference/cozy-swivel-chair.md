# West Elm Cozy Swivel Chair — geometry reference (from Shyam's photos, 2026-07-17)

Shyam re-shared four reference images (product cutout, two lifestyle shots, one
close-up of the back/arm ring, one in-situ pair by a window wall) for the rung-0
rebuild of `buildSwivelChair` in the PoC-2 scene. The chat surface delivered them as
vision input only, so the pixels couldn't be saved into the repo — this note records
everything geometry-relevant that they show. If the files themselves are wanted in
the repo later, they need to be added via a path that lands them on disk (e.g. commit
through the GitHub web UI to `spike/reference/`). Colorway matches Shyam's chair:
chunky black-and-white "salt-and-pepper" melange basketweave, reads dark grey overall.

## Overall form

- One continuous closed pod. There is **no** visible base, pedestal, column, legs, or
  seam between body and floor from normal viewing height — the shell's lower half is a
  squashed hemisphere that tucks inward and down to a concealed swivel plinth. At most
  a thin dark shadow line at the floor.
- Silhouette from the front is a slightly flattened sphere/egg: widest at arm height,
  narrowing both toward the floor and toward the back apex. Width ≈ 98, depth ≈ 90,
  total height ≈ 76 (per OUTCOME.md review note; images are consistent with
  width ≥ height by a clear margin — the chair reads wider than tall).
- **Back and arms are a single ring**, not separate parts: a thick upholstered rim
  (roughly 18–22 cm thick in section, rounded like a torus segment) that rises to its
  apex at the rear center (~76) and sweeps continuously down and forward along both
  sides, terminating at the front at roughly seat-cushion height (~40–45). The front
  third of the pod has no rim — that's the open entry.
- The ring's outer face is flush with the pod body — from outside, body and ring read
  as one surface; the ring only reads as a rim from the front/inside, where the
  seat-well is scooped out of the pod.

## Seat

- One loose round-cornered seat cushion, thick (~15–18 cm section), roughly a
  rounded-square/disc plan shape, inset inside the ring. Cushion top sits ~38–42 cm
  above floor (low, lounge-y — NOT the 45–47 of a task chair).
- The cushion's front edge slightly overhangs/rounds over the pod's front lip; there
  is a horizontal seam line under it across the front face (visible in the cutout and
  close-up shots). No gap between cushion and shell anywhere — nothing for a depth map
  to split off (spike 1's phantom "side table" came from the old floating seat rim).

## Modeling directive for scene2 (`buildSwivelChair` rewrite)

Approximate as a lathe/CSG-ish compound, all one dark-grey material:

1. **Pod body**: squashed sphere (e.g. sphere scaled to 98 × ~70 × 90, center ~y 35),
   floor-clipped, so the underside tucks inward — or a lathe profile: floor r≈30 →
   max r≈49 at y≈35–45 → tapering into the rim top.
2. **Seat well**: front-upper quadrant scooped out — in primitive terms, put the seat
   cushion (rounded cylinder/box, top ~y 40) inside, and let the ring stand above the
   body only around the back ~240° arc.
3. **Ring**: torus segment (tube r ≈ 10) following the pod's top edge, apex ~y 76 at
   the rear, sweeping down to ~y 45 at the two front ends. A tilted torus (raised at
   back, dipped at front) intersecting the pod body is an acceptable approximation.
4. **No** foot disk, no column, nothing below the pod. Orientation unchanged: open
   front faces SE into the room, apex to the NW corner.

Sanity checks against the photos: apex 76 ≪ old model's 100; widest point is at/below
mid-height; from the couch-view camera the chair should read as one rounded mass with
a dark seat shadow in its mouth, not as seat-plus-backrest parts.
