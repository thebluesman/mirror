# D3 memo — three-gpu-pathtracer feasibility for rung 4

Date: 2026-07-17. Probe artifacts (probe page, pathtracer page, Playwright runner,
sample render): `/tmp/claude-0/-home-user-mirror/ca9f0ac4-5f25-534f-92e3-090a114df162/scratchpad/ptprobe/`.
Everything below was measured in this session's environment, not guessed.

## Verdict: GO, with a reframe on render time

The library works end-to-end in this headless environment today: WebGLPathTracer
instantiated against Three.js r160, BVH built, progressive samples rendered, correct
path-traced pixels (soft shadows, GI color bleed) captured via Playwright screenshot.
But the GPU here is SwiftShader (software rasterizer/compute), so the honest framing is
**minutes-to-hours per still, not seconds-to-minutes**: roughly **25–90 min for a
decision-quality 1024×768 still** of the ~30-object room (details in §4). That fits the
plan's "one good and one bad result are both useful" clause — the pipeline is viable,
renders can run unattended/batched inside the 1-day D6 timebox, but interactive
iteration on materials at path-traced quality is not possible in this environment.

## 1. Pinned versions

| package | version | why |
|---|---|---|
| three | **0.160.0** | already pinned by `scene.html` |
| three-gpu-pathtracer | **0.0.23** (2024-06-07) | last version compatible with r160. 0.0.24 (2026-02) requires `three >= 0.180` — do not use. WebGLPathTracer API (the simplified `setScene`/`renderSample` API) exists since 0.0.21; 0.0.23 is the most mature of that line. |
| three-mesh-bvh | **0.7.8** (2024-09-11) | last of the 0.7.x line; three-gpu-pathtracer 0.0.23 declares `three-mesh-bvh >= 0.7.4`. npm shows a deprecation notice ("use 0.8.0") — that's about *newer* three versions; 0.7.8 is correct for r160 and worked in the probe. |
| xatlas-web | not needed | declared dep, but only used by `UVUnwrapper`; the browser bundle `build/index.module.js` has no xatlas import. |

Verified bare-specifier imports of `three-gpu-pathtracer@0.0.23/build/index.module.js`
(the classic importmap failure point): `three`, `three-mesh-bvh`, and
`three/examples/jsm/postprocessing/Pass.js`. All three must be mapped.

### Environment reality check: CDNs are blocked here

`unpkg.com` and `cdn.jsdelivr.net` both fail with proxy 403 (CONNECT denied) from this
session — **including for headless Chromium**, which means `scene.html`'s existing unpkg
importmap also cannot load in-session. `registry.npmjs.org` *is* on the proxy allowlist,
so the working pattern is: `npm install` the pinned packages, serve them with a local
static server, and use a local importmap. This is what the probe does and what
`pathtrace.html` should do.

```bash
npm install three@0.160.0 three-mesh-bvh@0.7.8 three-gpu-pathtracer@0.0.23
npx http-server -p 8811   # or the 20-line node server in the probe's run.mjs
```

```html
<script type="importmap">
{
  "imports": {
    "three": "/node_modules/three/build/three.module.js",
    "three/addons/": "/node_modules/three/examples/jsm/",
    "three/examples/jsm/postprocessing/Pass.js": "/node_modules/three/examples/jsm/postprocessing/Pass.js",
    "three-mesh-bvh": "/node_modules/three-mesh-bvh/build/index.module.js",
    "three-gpu-pathtracer": "/node_modules/three-gpu-pathtracer/build/index.module.js"
  }
}
</script>
```

(For a machine with open network, the same map works with
`https://unpkg.com/<pkg>@<version>/...` URLs — the entry points are
`three-gpu-pathtracer@0.0.23/build/index.module.js` and
`three-mesh-bvh@0.7.8/build/index.module.js` — but that cannot be tested from here.)

### Required r160 compatibility shim (found the hard way)

0.0.23 declares `three >= 0.151` but actually reads `Scene.environmentRotation` /
`Scene.backgroundRotation`, added in **r163** — instant crash in the WebGLPathTracer
constructor (which also builds an internal `new Scene()`, so patching your own scene
instance is not enough). Three-line fix before constructing the tracer:

```js
for (const prop of ['environmentRotation', 'backgroundRotation']) {
  if (!(prop in THREE.Scene.prototype)) {
    const key = Symbol(prop);
    Object.defineProperty(THREE.Scene.prototype, prop, {
      get() { return this[key] ?? (this[key] = new THREE.Euler()); },
      set(v) { this[key] = v; },
    });
  }
}
```

## 2. Headless WebGL2 probe results

Playwright 1.56.1 (global install, symlink it into the project `node_modules` for ESM
import) + Chromium from `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).

- **WebGL2: yes**, under default headless args, `--use-angle=swiftshader`, and
  `--enable-unsafe-swiftshader` alike (identical caps). Default args emit a "automatic
  software WebGL fallback is deprecated" warning, so launch with
  `--enable-unsafe-swiftshader` to be explicit and future-proof.
- **Renderer string:** `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)
  (0x0000C0DE)), SwiftShader driver)` — pure software.
- **Float textures:** `EXT_color_buffer_float` yes, `OES_texture_float_linear` yes
  (both required by the tracer's float accumulation buffers). Max texture 8192,
  max array layers 2048, 4096 fragment uniform vectors — all comfortable.

## 3. Measured path-tracer performance (SwiftShader)

Probe scene: floor plane + 5 PBR boxes, gradient equirect environment, one directional
light, `bounces` as noted, `renderScale = 1`, ACES tone mapping.

| resolution | bounces | time/sample | BVH build |
|---|---|---|---|
| 512×384 | 5 | **2.63 s** | 0.27 s |
| 1024×768 | 5 | **8.11 s** | 0.35 s |
| 1024×768 | 3 | 7.75 s | 0.27 s |

Time scales ~linearly with pixel count; dropping bounces 5→3 saves almost nothing
(SwiftShader is ray-throughput bound, and in an open scene most paths terminate early —
in a closed room the gap may widen slightly). At 6 samples the image already reads
correctly, just noisy.

## 4. Per-still wall-time estimate for the real scene

The ~30-object room adds BVH depth (log-scale, cheap) but, being enclosed, keeps every
bounce alive — expect ~1.5–2× the probe's per-sample cost: **~12–16 s/sample at
1024×768**.

- 100 samples (noisy but judgeable): **20–27 min**
- 200 samples (decent): **40–55 min**
- 500 samples (clean): **1.7–2.2 h**
- At 800×600 multiply by ~0.6; `renderScale = 0.5` + upscale quarters it again.

So: the plan's "seconds-to-minutes" holds only on real GPUs; **here it's
minutes-to-hours**. Practical D6 shape: fire renders as unattended background Playwright
jobs (screenshot checkpoint every N samples so a 100-sample early frame is banked even
if you kill the run), 2 views × 2 variants ≈ one afternoon of machine time. That fits
the timebox; per-material-tweak iteration at full quality does not — iterate at
256×192 (~40 s for 60 samples) and only pay full price for contact-sheet frames.

## 5. Scene-porting gotchas (hit or verified in the probe)

1. **RoomEnvironment/PMREM environments crash the tracer** (undefined `image.data` in
   `EquirectHdrInfoUniform.updateFrom`). The environment must be an *equirect* texture:
   the library's `GradientEquirectTexture` (what the probe uses) or an equirect HDR via
   `RGBELoader`. If rung 1's scene2 uses `PMREMGenerator.fromScene(RoomEnvironment)`,
   `pathtrace.html` must substitute, not reuse, that env.
2. **Only path-traceable state is honored.** Shadow-map config (`castShadow`,
   `shadow.mapSize`, shadow biases, shadow-only hacks) is ignored — shadows come free
   from the integrator. Supported lights in 0.0.23: Directional, Point, Spot, RectArea
   (+ environment + emissive materials). Light intensities will need retuning; don't
   expect raster-tuned values to match.
3. **Transparent glazing:** alpha/`transparent:true` is treated as coverage, not
   refraction. For the balcony door/window glass use `MeshPhysicalMaterial` with
   `transmission: 1`, low roughness, sensible `ior` — or simply omit glass panes (an
   open doorway lights identically and renders faster).
4. **Static scene assumption.** `setScene()` flattens geometry + materials into BVH and
   texture atlases (~seconds for this scene). Any object/material change requires a
   re-`setScene`; camera moves only need `updateCamera()`/reset. Fine for stills.
5. **Textures** get packed into a `WebGLArrayRenderTarget` atlas — keep rung-2 textures
   modest (≤1K) and uniform-ish in size to avoid atlas blowup at 8192 max texture size.
6. **Integration pattern:** new `spike/pathtrace.html` that imports the same
   `geometry.json` and shares the scene-building/material code with `scene2.html`
   (extract a `buildScene()` module or copy it — do not add tracer code paths to
   scene2). Keep the same `?cam=` presets so stills are pixel-comparable to the raster
   contact sheet. Serve locally (§1), drive with a Playwright script modeled on the
   probe's `run.mjs`, launch args `--enable-unsafe-swiftshader`.
