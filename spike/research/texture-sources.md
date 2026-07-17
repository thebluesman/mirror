# D2 memo — Texture sources for the rung-2 pass (scene2.html, Three.js r160)

Tested 2026-07-17 from this session (all HTTPS via the agent proxy). Every result below
is from a real download attempt, payload verified with `file`, not a DNS check.

## 1. Reachability

| Source | URL tried | Result |
|---|---|---|
| Poly Haven API | `api.polyhaven.com/files/oak_veneer_01` | **BLOCKED** — proxy 403 (egress policy denial) |
| Poly Haven CDN | `dl.polyhaven.org/.../wood_table_001_diff_1k.jpg` | **BLOCKED** — 403 |
| ambientCG | `ambientcg.com/get?file=Wood062_1K-JPG.zip` | **BLOCKED** — 403 |
| unpkg | `unpkg.com/three@0.160.0/build/three.module.js` | **BLOCKED** — 403 |
| jsDelivr | `cdn.jsdelivr.net/npm/three@0.160.0/...` | **BLOCKED** — 403 |
| npm registry | `registry.npmjs.org/three/-/three-0.160.0.tgz` | **OK** — 9.4 MB, valid gzip tarball |
| GitHub raw | `raw.githubusercontent.com/mrdoob/three.js/r160/examples/textures/hardwood2_diffuse.jpg` | **OK** — valid JPEG 2048×1024, 404 KB (bump 115 KB + roughness 143 KB also OK) |
| api.github.com | tree/contents API | BLOCKED direct (403); GitHub MCP is scoped to `thebluesman/mirror` only |

Policy denials are final per the proxy README — do not retry or route around them.

**Critical gotcha for D1/D4:** `scene.html`'s importmap loads Three.js from **unpkg,
which is blocked here** — a headless capture of an unmodified fork renders nothing.
`scene2.html` must vendor `build/three.module.js` (and any `examples/jsm` addons) from
the npm tarball into e.g. `spike/vendor/` and point the importmap at relative paths.
Verified working end-to-end (headless screenshot shows textured geometry).

## 2. Per-item recommendation

CC0 libraries are unreachable, so **procedural canvas textures are the primary source**
for everything; the three.js repo's `hardwood2` set (MIT, reachable) is the one real
photo texture worth using, tinted per wood species. ambientCG URLs are listed as
out-of-band candidates (CC0, no attribution) if Shyam downloads them locally into
`spike/textures/` — names unverifiable from here since the catalog is blocked.

| Item | Primary (procedural recipe) | Optional real texture | Tier 1 (§2) with procedural alone? |
|---|---|---|---|
| TV stand, coffee table — oak | 1-D noise stretched along grain (2–4 px bands, alpha 0.05–0.2) over warm base `#b08d5e`, sparse darker streaks; roughness ~0.55 | `hardwood2_diffuse/bump/roughness` (three.js r160 repo, verified) tinted oak; or ambientCG `Wood062_1K-JPG.zip` | **Yes** — grain anisotropy + color carries "oak" |
| Bookshelf — pine | Same generator, paler/yellower base `#d9bf94`, add 3–6 random dark elliptical knots (concentric rings) | hardwood2 tinted light; ambientCG Wood051-ish | **Yes** — knots are the pine tell, trivial to draw |
| Dining legs — pecan | Same generator, deep red-brown `#7a5236`, tighter grain | hardwood2 tinted dark | **Yes** — small screen area, color does the work |
| Sofa — Lejde light grey fabric | High-freq low-contrast grey noise + faint 2 px diagonal crosshatch; reuse noise as bumpMap, roughness ~0.9 | ambientCG `Fabric030_1K-JPG.zip` (out-of-band) | **Yes** |
| Swivel chair — charcoal melange | Salt-and-pepper: per-pixel random black/white/grey speckle averaging dark grey `#3a3a3c` | none needed | **Yes** — melange *is* noise; procedural beats photo here |
| Rug — SÖNDERÖD blue high pile | 4–6 overlapping radial-gradient watercolor blobs (blue range) + heavy fine noise + strong bumpMap for pile; roughness 1.0 | ambientCG `Carpet008`-class set (out-of-band) | **Yes** for color/size decisions; pile depth itself is Tier 2 |
| Billy doors — bamboo weave | Drawn basket weave: alternating H/V slats (~8×32 px) with per-slat luminance jitter + darkened overlap edges, tan `#c9a86b`, clear-lacquer roughness ~0.4 | none good generic match exists | **Yes** — regular weave is ideal canvas material |
| Floor — 60×60 light greige porcelain | Flat `#d9d4cb` + grout lines at cm-true 60 cm UV spacing + per-tile ±2% luminance jitter; roughness ~0.25 + env map for the slight reflectivity | ambientCG `Tiles101`-class (out-of-band) | **Yes** |
| Book spines (cubbies) | Random-width vertical colored stripes per cubby (muted palette + occasional bright) | — | **Yes** — exactly what §3 rung 2 prescribes |

Verdict: **procedural alone clears the Tier 1 bar for every item.** The only place a
photo texture visibly helps at Tier 1 is wood grain — use the verified hardwood2 set
as base + `ctx.fillStyle` tint per species if procedural grain looks synthetic.

## 3. Embedding logistics (verified by headless capture)

- Separate files in `spike/textures/` loaded with relative `TextureLoader` paths work.
- **Local static server** (`python3 -m http.server`): works out of the box — modules,
  importmap, and relative texture files all load. **Recommended for the capture flow.**
- **file://**: ES-module import is CORS-blocked ("origin 'null'") unless Chromium gets
  `--allow-file-access-from-files`; with that flag everything works, including textures.
- Canvas/`CanvasTexture` needs no network and no CORS in either mode — safest path.
- Headless flags that worked: `--headless --no-sandbox --disable-gpu
  --use-angle=swiftshader --virtual-time-budget=8000 --screenshot=...`
  (binary at `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`).

## 4. Gotchas summary

- unpkg/jsDelivr blocked → vendor Three.js from npm (allowed, bypasses proxy). ~1.3 MB
  `three.module.js`; commit it or fetch at session start.
- Licenses: ambientCG + Poly Haven are CC0 (no attribution); three.js repo textures are
  under the repo's MIT license — fine for the spike, keep a note in scene2.html.
- Sizes: stay at 1k. hardwood2 3-map set ≈ 670 KB; canvas textures cost 0 bytes on disk.
- Anisotropy: set `texture.anisotropy = renderer.capabilities.getMaxAnisotropy()` on the
  floor tile or the grout lines shimmer at grazing camera angles.
