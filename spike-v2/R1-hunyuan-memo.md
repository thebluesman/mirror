# R1 — Hunyuan3D on fal.ai: endpoint, pricing, CORS-feasibility memo

**Status:** research only, no code run, no FAL_KEY used. Feeds D5 (separate,
later, real comparison spike). Supersedes nothing in ADR-0001; W-C/§5 of
`v2-spike-plan.md` still requires a new ADR before any adoption.

Sources: fal.ai's own model pages and docs (`fal.ai/hunyuan-3d`, individual
`fal.ai/models/fal-ai/hunyuan3d*` pages, `fal.ai/docs/...`) via search-engine
snippets — fal.ai's site itself 403s a plain fetch (likely bot/UA
protection), so figures below are triangulated from indexed page content and
a third-party pricing gist, not a live authenticated page load. Flagged
per-item below as **[fal docs]** vs **[inferred/triangulated]**. D5 should
re-confirm exact schema fields against a live `fal.subscribe` call before
relying on any of this for code.

## 1. Endpoints that exist

Two model families, both hosted at `fal-ai/...`:

**v2 family** (older, cheaper):
- `fal-ai/hunyuan3d/v2` — base, single image **[fal docs]**
- `fal-ai/hunyuan3d/v2/turbo` — faster/cheaper single image **[fal docs]**
- `fal-ai/hunyuan3d/v2/mini` — smaller/cheaper single image **[fal docs]**
- `fal-ai/hunyuan3d/v2/mini/turbo` **[fal docs]**
- `fal-ai/hunyuan3d/v2/multi-view` — multi-image input **[fal docs]**
- `fal-ai/hunyuan3d/v2/multi-view/turbo` **[fal docs]**

**v3.1 family** (newer, higher quality, the ones fal is currently
front-paging on `fal.ai/hunyuan-3d`):
- `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` — best quality; supports **up to
  8 view angles** (front, back, left, right, top, bottom, two 45° diagonals)
  in one request **[fal docs]**
- `fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d` — faster/cheaper, **single
  front view only** **[fal docs]**
- There's also a `fal-ai/hunyuan3d-v3/image-to-3d` (and a
  `.../sketch-to-3d` variant) that appears distinct from the `v3.1/pro`/
  `v3.1/rapid` naming — the v3 vs v3.1 relationship isn't fully resolved
  from search snippets alone; **D5 should check `fal.ai/hunyuan-3d` live to
  confirm which v3-ish name is current** before picking one.

## 2. Which one Shyam most likely used

**[inferred]** — no way to confirm without his account history. `fal.ai/hunyuan-3d`
is fal's landing/playground page for the model family and is what "the fal
dashboard" almost certainly means. Two candidates fit "noticeably better
than Meshy, supports multi-angle":

- **`fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`** — best fit: it's the
  highest-quality tier and the only one with real multi-view (8 angles),
  matching both halves of Shyam's report in one endpoint.
- `fal-ai/hunyuan3d/v2/multi-view` — older but also multi-view-capable, less
  likely given fal is now front-paging v3.1 as the flagship.

**Recommendation:** D5 should not guess further — check whether Shyam's
fal.ai account/billing history shows the actual endpoint id used (fal's
dashboard logs requests per-model), or just ask him to re-open the same
playground page and read the endpoint id off the URL/network tab. Failing
that, D5's slate should default to **v3.1 Pro** as the primary comparison
target (matches the quality claim) with v2/multi-view as a cheap secondary
data point.

## 3. Multi-angle/multi-view support — the capability Meshy lacks

Confirmed on fal's side, **[fal docs]**:

- `v3.1/pro/image-to-3d` — up to 8 named view-angle image inputs per
  request (front/back/left/right/top/bottom/two diagonals).
- `v2/multi-view` and `v2/multi-view/turbo` — multi-image input; field names
  seen in the multi-view API doc include `front_image_url`,
  `back_image_url`, `left_image_url` (i.e. **named per-angle fields, not an
  array** — different request shape from Meshy's single `image_url`).
- `v3.1/rapid` and plain `v2`/`v2/turbo`/`v2/mini` — single front image
  only, same shape as Meshy's `image_url`.

So: yes, the multi-angle capability is real and fal-hosted, but it lives in
specific endpoints (not a flag on the base model), and its request shape
differs from single-image endpoints (named per-view fields rather than one
`image_url`).

## 4. Pricing — **[fal docs / triangulated, treat as approximate]**

Numbers below came from multiple overlapping but not fully consistent
sources (fal's own pages, a third-party pricing gist); flagged where they
disagree. Meshy is ~$0.80/run per spike 3.

| Endpoint | Price per generation | Confidence |
|---|---|---|
| `hunyuan3d/v2` (base, textured) | ~$0.16 (white mesh only); +~3x (~$0.48) with texture | medium — two sources agree on $0.16/$0.48 split |
| `hunyuan3d/v2/turbo` | ~$0.14 | medium |
| `hunyuan3d/v2/mini` | ~$0.10 | medium |
| `hunyuan3d/v2/mini/turbo` | ~$0.08 | low — single source |
| `hunyuan3d/v2/multi-view` | conflicting: one source says same as base (~$0.16), a pricing-gist scrape says $0.017 — the low figure looks like a scrape artifact (per-unit vs per-request mismatch) | **low — do not trust either without live confirmation** |
| `hunyuan-3d/v3.1/rapid/image-to-3d` | ~$0.225 | medium |
| `hunyuan-3d/v3.1/pro/image-to-3d` | ~$0.375 base; add-ons: +$0.15 PBR, +$0.15 multi-view, up to ~$0.45 for low-poly variant | medium |

**Bottom line for budgeting D5:** every Hunyuan3D variant is cheaper
per-run than Meshy's ~$0.80, even the priciest Pro+PBR+multi-view
combination (~$0.60–0.70 worst case). Cost is not a blocker either way — D5
should still pull the exact number from a live `fal.subscribe` response
metadata or fal's billing page before finalizing the $10–20 W-C budget
in the spike plan, since the multi-view figure above is unreliable.

## 5. Browser-direct feasibility (CORS)

ADR-0001 verified three legs for Meshy: **upload** (`fal.storage.upload`),
**submit + poll** (`fal.subscribe` on the model endpoint), and **result GLB
download** (direct fetch from the returned `v3b.fal.media` URL).

All Hunyuan3D endpoints sit on fal's same generic queue-job REST platform
(`fal-ai/<model>` addressed through `@fal-ai/client`'s `fal.subscribe` /
`fal.storage.upload`) — there is nothing model-specific about fal's
transport layer, so the same three legs should hold **[inferred, high
confidence — this is fal's platform-wide contract, not per-model]**:

- Upload: identical call, `fal.storage.upload(photo)`, regardless of
  endpoint — no reason to expect this to differ.
- Submit + poll: identical `fal.subscribe(ENDPOINT, { input, onQueueUpdate })`
  pattern; only `ENDPOINT` and `input` shape change.
- Download: Hunyuan3D's output schema includes a `model_mesh` object with a
  `url` field **[fal docs]** — this actually matches
  `falClient.ts`'s existing `GLB_URL_KEY_CANDIDATES[0]` (`"model_mesh.url"`)
  exactly, so no new URL-extraction logic should be needed.

**What might differ, flagged as a real finding rather than assumed:**
- **Multi-view endpoints change the request shape**, not just add a field —
  named per-angle keys (`front_image_url`, `back_image_url`, ...) mean
  multiple `fal.storage.upload` calls (one per angle) before one
  `fal.subscribe` call, versus Meshy/single-image Hunyuan's one-upload
  one-submit shape.
- No fal doc surfaced anything suggesting Hunyuan3D endpoints have
  different CORS behavior than Meshy (same client library, same queue
  infra) — but this is inferred from platform consistency, not verified
  by an actual browser call. D5 (or a quick throwaway HTML probe, same
  method ADR-0001 used) should still confirm this empirically before
  PRD-v2 leans on it, per the spike plan's "nothing counts until it's
  actually tried" discipline.

## 6. Comparison protocol recommendation for D5

**Single-image comparison (Meshy vs. Hunyuan, matching input):** this can
reuse `falClient.ts`'s existing shape almost verbatim — swap `ENDPOINT` and
`REQUEST_DEFAULTS` for the Hunyuan variant chosen (recommend
`fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` for the quality-comparison item,
single front image, one view field only), keep the same
upload → subscribe → extractGlbUrl → download flow. Concretely:

- Add a second small module (e.g. `hunyuanClient.ts`) that parallels
  `falClient.ts`'s structure rather than parameterizing the existing one —
  the two providers' `REQUEST_DEFAULTS` shapes differ enough (Meshy:
  `should_texture`/`topology`/`target_polycount`/`origin_at`; Hunyuan:
  different param names entirely, TBD from a live schema check) that
  forcing one function to branch on provider would be messier than two
  small parallel files sharing the upload/download helpers.
- `extractGlbUrl`'s existing candidate-list approach already covers
  Hunyuan's `model_mesh.url` shape — reuse it unchanged.

**Multi-angle test (1–2 items, Hunyuan only):** needs its own small
function, since the request shape is genuinely different — multiple
uploads (one per angle) feeding named fields
(`front_image_url`/`back_image_url`/...) into one `fal.subscribe` call on
`fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` (or `hunyuan3d/v2/multi-view` for
the cheaper v2-family probe). This is additive, not a fork of the
single-image path — the same `fal.storage.upload` helper is called N times
before one submit.

**Net recommendation:** don't try to generalize `falClient.ts` into a
multi-provider abstraction for D5 — that's premature given only three items
and one comparison run planned. Two small sibling client files (or two
functions in a new `spike-v2/` script, following the "W-C is scripted, not
app code" placement per `v2-spike-plan.md` §4) is the cleaner path, and
matches how spike 3's `generate.py` was already structured as a standalone
script rather than reusing app code.

## Open items for D5 to resolve before spending API budget

1. Confirm the exact endpoint Shyam used (dashboard history or re-check the
   URL), rather than assuming v3.1 Pro.
2. Confirm live pricing for whichever endpoint(s) are chosen — the
   multi-view figure above is unreliable.
3. Confirm live request/response schema with one real `fal.subscribe` call
   before writing the comparison harness — this memo's field names come
   from indexed docs, not a live response.
4. Empirically verify the three CORS legs for the chosen Hunyuan endpoint,
   the same way ADR-0001 did for Meshy — inferred-safe is not verified-safe.
