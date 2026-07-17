# Research memo — Image-to-3D generation for the furniture-import phase

Researched 2026-07-17. Question: when the app grows a furniture-import flow (photo or
product-listing image in → placeable object out), is it reasonable to bake in
image-to-3D mesh generation via fal.ai, given the app's actual bar — **dimensional
truth in cm + "reads as the right category and color"**, not photorealism?

Candidates (both already tested manually by Shyam on his fal account):
- `fal-ai/meshy/v6/image-to-3d`
- `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` (the "hunyuan-3d-pro-image-to-3d" pro tier)

**No live test was run from this session.** No FAL_KEY exists anywhere reachable
(environment, shell profiles, `~/.fal`, repo `.env`/settings — spike 1 passed the key
inline per run, see OUTCOME.md's run commands). Everything below is from the fal model
pages, Meshy's API docs, and vendor documentation; the one thing docs can't settle —
actual silhouette quality on *these specific items* — is exactly what Shyam's manual
tests and the proposed mini-spike (§6) cover.

## 1. What the endpoints are

| | Meshy 6 (via fal) | Hunyuan 3D v3.1 Pro (via fal) |
|---|---|---|
| Endpoint | `fal-ai/meshy/v6/image-to-3d` | `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` |
| Input | 1 image URL (jpg/png/webp/…) | 1–8 view images (multi-view is a paid option; top/bottom/diagonal views new in 3.1) |
| Output formats | GLB, FBX, OBJ, STL, USDZ (GLB is the safe default; textures bundled) | GLB + OBJ + thumbnail |
| Textures | Base color + normal; `enable_pbr` adds metallic/roughness (+emission on newer models); 4K base color with `hd_texture` | Baked albedo; PBR (albedo/normal/roughness, up to 4K) as a +$0.15 option |
| Polycount control | `target_polycount` 100–300k (remesh) or 100–15k (smart topology); quad or triangle | 40k–1.5M faces; custom face count is a +$0.15 option; quad topology supported |
| Scale/units | Unitless by default; **`auto_size: true`** has the model estimate real-world size and scale the GLB accordingly, `origin_at: bottom` puts the pivot at floor level | Normalized output; no documented real-world-size estimation |
| Price (fal) | **$0.80 / generation** | **$0.375 base** + $0.15 PBR + $0.15 custom face count + $0.15 multi-view → $0.375–0.83 |
| Latency | ~1–4 min typical (preview mesh ~30 s; texturing dominates) | Pro: ~3–6 min (Rapid tier: 2–3 min) |
| License | fal lists commercial use (partner arrangement). Direct-from-Meshy paid plans give full private ownership of outputs; free tier is CC BY 4.0 with attribution | fal lists commercial use. Tencent's open-weight community license (EU/UK/KR territory exclusions) applies to self-hosted weights, not the fal-served API; irrelevant for a personal tool in the UAE either way |
| API shape | fal queue/subscribe, same `fal_client.subscribe(...)` pattern `spike/generate.py` already uses | same |

## 2. Fit against the app's bar, point by point

**(a) Dimensional fidelity.** Generated meshes are not dimensionally trustworthy and
never will be — that's fine, because the app never needs them to be. The import flow
product-review.md already specifies ("confirm dimensions before insert") has the user
enter W×D×H in cm; the app rescales the GLB's bounding box to those numbers per-axis.
The mesh supplies *shape*, the user supplies *truth* — same division of labor as
today's authored primitives, where the cm values also come from product pages, not the
geometry. Meshy's `auto_size` is a nice prefill for the dimension form, nothing more.
Non-uniform per-axis rescale slightly distorts proportions when the generation is off;
at furniture scale viewed from room distance that's well inside Tier 1 tolerance.

**(b) Silhouette correctness — the "outline and voids" rule.** This is where
image-to-3D is strongest relative to the current pipeline. Every identity failure
across spike 1's 21 images traced to a silhouette shortcut a human didn't have time to
model (dining-table-as-kitchen-island, the swivel-chair office-chair archetype, the
shoe-cabinet box). An image-to-3D model reconstructs legs, under-gaps, the chair's
closed pod, and overall mass directly from the photo — the exact class of geometry
that costs the most artist-minutes by hand. Known weak spots from vendor docs and
general reports: hallucinated unseen backs (single-view), fused thin members (chair
legs, lamp arms), and glass/transparency — the same cases product-review.md flagged
for photogrammetry, but milder, since these are generative priors rather than
reconstruction. For furniture (big convex masses + a few voids) the failure surface is
small; Hunyuan's multi-view input covers the unseen-back problem when the user owns
the piece and can walk around it.

**(c) Texture/material vs. the PBR pipeline.** Both return textured GLBs whose albedo
is derived from the input photo — so category and color (charcoal melange, oak, white
lacquer) come along for free, which is precisely the Tier 1 material requirement the
rung-2 procedural work spends effort meeting per item. Both offer optional
roughness/metalness/normal maps, so imports slot into the `MeshStandardMaterial` +
ACES + env-map pipeline of scene2 without a parallel rendering path. Two caveats:
baked-in lighting from the source photo can fight the scene's sun (mitigate by
preferring flat catalog shots), and generated roughness maps are approximate — worst
case, treat the import like any other item and override roughness/metalness scalars
from furniture-notes-style specs.

**(d) Cost and latency.** $0.40–0.80 and 2–6 minutes *per imported item, once ever*.
An apartment has ~15–25 furniture items and imports happen at authoring time, not
render time. Total cost to mesh Shyam's entire living room is under $15 — compare
spike 1, which spent ~$0.85 on 21 *disposable* images. Both numbers are trivially
acceptable for an occasional, user-initiated import step; latency just needs an async
"generating…" state, which the fal queue API gives for free.

**(e) Local-first tension.** Real but narrow. PoC 2 eliminated the cloud dependency
from the *render loop* — every frame, every decision. This proposal puts the cloud
only in the *asset-creation* moment: one API call per item, result cached as a GLB in
the local project forever, viewable offline, no key needed after import. That's the
same shape as "download an IKEA 3D asset," not the same shape as spike 1's per-render
fal dependency. Framing: **optional import-time enhancement with the authored-primitive
path as the offline/no-key fallback** — the primitive path must stay first-class
anyway, since it's what rooms, built-ins, and anything unphotographable use.

## 3. Where this sits relative to prior decisions

- product-review.md ("3D model extraction from photos") already ruled: don't build
  photogrammetry in-house; *"if it's useful later, integrate one of those providers'
  APIs."* A hosted image-to-3D endpoint is exactly that sentence, and strictly lighter
  than the Polycam/Luma scan-app flow it suggested — one photo instead of a capture
  session, and it works on product-listing images for furniture you don't own yet
  (the app's main pre-purchase use case).
- product-review.md §"Fidelity" item 3 scoped "real furniture assets" as its own
  milestone after the single-room prototype — this is the candidate mechanism for that
  milestone, cheaper than sourcing/converting per-retailer catalog models.
- poc2-plan.md §6 explicitly excludes catalog 3D assets from spike 2. Nothing here
  changes PoC 2; the spike must still prove the *pipeline* (materials, lighting,
  path-traced stills) on authored primitives.

## 4. Polycount and runtime budget

The room scene is currently a few thousand triangles total. A single default Hunyuan
Pro mesh (up to 1.5M faces) would dwarf the whole scene and hurt on a laptop GPU once
15 items are imported. Two workable paths:

- **Meshy smart topology at 10–15k** (or remesh at ~30k) — right-sized at the API, no
  post-processing.
- **Hunyuan at min face count (40k, +$0.15)** then decimate locally, e.g.
  `npx @gltf-transform/cli simplify in.glb out.glb --ratio 0.25` — works, but adds a
  pipeline step the Meshy knob makes unnecessary.

Budget guideline: ≤30k triangles per furniture item keeps a 25-item room under ~750k,
comfortably real-time in Three.js with the scene2 pipeline.

## 5. Endpoint comparison verdict

**Meshy 6 first.** It matches the import flow's needs at the API surface: polycount
control in-range for real-time (no decimation step), `auto_size` + `origin_at: bottom`
(floor-pivot, prefilled dimensions), PBR maps included in the flat price, more export
formats, and faster typical turnaround. $0.80 vs ~$0.68 (Hunyuan with PBR + face
count) is noise at import frequency.

**Hunyuan 3D v3.1 Pro as the second lever, not the default.** Its distinctive value is
multi-view input (up to 8 angles) — the right tool when the user *owns* the piece and
a single-view generation gets the back wrong. A plausible v1 flow: Meshy single-image
by default; "add more photos" escalation runs Hunyuan multi-view. Its 1.5M-face
ceiling solves a problem this app doesn't have.

Shyam's manual tests of both should override this ranking if they showed a clear
quality gap in either direction — the docs can't see output quality.

## 6. Recommendation

**Prototype later — after PoC 2's C2 checkpoint, as a small spike 3. Do not bake it
into PoC 2, and do not drop it.**

- *Not into PoC 2:* the spike's question is whether the in-house appearance layer
  clears Tier 1 at all; catalog-grade assets are explicitly out of scope (§6), and
  mixing generated meshes into the checkpoint contact sheets would contaminate the
  verdict on the authored-primitive pipeline — the thing the product "could actually
  sustain per object" claim rests on.
- *Not dropped:* it attacks the acknowledged scaling bottleneck (artist-hours per
  object) at its strongest point — silhouettes with voids, the single largest source
  of identity failures in spike 1 — while every hard requirement (cm truth, category,
  color) is either handled by the existing confirm-dimensions flow or delivered free
  by photo-derived textures. Cost and latency are non-issues at import frequency, and
  the local-first story survives as "cloud at import, cached forever."
- *Spike 3 shape (½–1 day, ~$5 of credits):* take the 3 items with the worst
  authored-primitive cost/benefit — Cozy swivel chair (pod), STÄLL (voids + legs),
  pine bookshelf (8 cubbies) — run each through Meshy 6 (smart topology ~15k, PBR,
  auto_size) and Hunyuan Pro (multi-view where photos exist); rescale to the known cm
  dims; drop the GLBs into scene2.html beside the authored versions; judge on the
  same two views against the same §2 Tier 1 bar. Inspect each GLB with
  `npx @gltf-transform/cli inspect` for polycount/textures/bounds. Go/no-go per item
  class, recorded in this directory.

If spike 3 passes, the v1 furniture-import phase becomes: photo → generate (Meshy) →
confirm cm dimensions → rescale + floor-snap → cached local GLB, with authored
primitives as the fallback and the room shell staying hand-authored. That is a
different, better product position than "app ships with whatever primitives got
modeled": the catalog becomes whatever the user can photograph.
