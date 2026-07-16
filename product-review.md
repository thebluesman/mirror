# Critical Review — Personal Home Digital Twin

A critique of `product-idea.md`, incorporating answers from Supritha (2026-07-16):
platform is undecided (recommendation wanted), a real Figma floor plan exists and the
importer stays, visual fidelity is "blocks now, better later", and the single core value
is **what-if visualization**.

---

## Verdict in one paragraph

The bones are good: the AI-commands-not-AI-scene-edits architecture, 2D-first editing,
the explicit "do not build" list, and the single-room first milestone are all the right
instincts. But the spec contains one unacknowledged contradiction at its center
(what-if visualization as the core value vs. block-level fidelity), one feature that is
close to infeasible as written (photo-based room verification), one feature that is
mis-assigned to the LLM (constraint-aware suggestions), and an accuracy claim
(cm-precision measurements from a "95% accurate" Figma plan) that doesn't survive
arithmetic. All are fixable with scope decisions, not heroics. The recommended stack is
also heavier than the product needs.

---

## The strongest parts — keep these

1. **The command layer.** `LLM → Scene Command → Validation → Scene DB → Renderer` is
   exactly right. It makes the AI swappable, the scene deterministic, and undo free
   (command pattern with inverse commands). This is the architectural decision the whole
   product hangs on.
2. **2D for arranging, 3D for evaluating.** Correct. 3D manipulation is where hobby
   projects go to die.
3. **The "explicitly avoid" list.** No AR/VR/marketplace/photorealism/CAD. Hold this
   line — every one of those is a project-killer for a two-person effort.
4. **Accuracy over realism as a principle.** Right idea, but see the contradiction
   below — the stated core value quietly disagrees with it.

---

## Major pushback

### 1. The core value contradicts the fidelity plan

Supritha named **what-if visualization** as the one capability that must be excellent.
But the spec's priority list puts "useful visualization" 4th and "realistic
materials/rendering" 5th, and the fidelity answer is "blocks now, better later."

Split "what-if" into its two actual meanings:

- **Layout what-ifs** — "what if I move the sofa here / fit a bigger table?" Blocks
  answer this perfectly well. Proportion, sight lines, and walkway feel all read fine
  from dimensioned boxes.
- **Aesthetic what-ifs** — "what would this room look like with a darker rug?" A dark
  gray rectangle instead of a beige rectangle answers almost nothing. The spec's own
  example (`CHANGE_MATERIAL → dark charcoal`) implies a fidelity level the spec
  simultaneously refuses to build.

**Recommendation:** commit explicitly. The MVP delivers *layout* what-ifs only, and
the doc should say so, so nobody is disappointed when the charcoal rug demo looks like
a Minecraft screenshot. Then put the fidelity upgrade on the actual roadmap rather than
hand-waving it: the realistic path is **compound parametric primitives** (a sofa =
base + back + two arms + legs, ~5 boxes/cylinders with rounded edges) which gets you
recognizable furniture for maybe 2–3 days of work per category, and optionally a small
curated glTF library later. If aesthetic what-ifs ever become the point, the "AI image
enhancement" future item is the honest route to them — not the realtime renderer.

### 2. Photo-based room verification: cut it

> "Sofa appears approximately 15cm deeper than model."

This requires monocular metric depth estimation plus registering an arbitrary phone
photo's camera pose against your 3D model, then attributing residual error to a
specific object at ±15cm. That is a research problem, not a feature. Casual photos have
unknown focal length, lens distortion, and no scale reference; state-of-the-art
monocular depth is proportionally wrong by far more than 15cm at room scale.

**Alternative that costs ~1% as much:** you already have saved camera positions. Let
the user attach a real photo to a saved viewpoint and render the model from that same
viewpoint side-by-side (or with an opacity slider). The *human* spots the 15cm
discrepancy instantly. Same job done, zero CV.

### 3. Constraint-aware suggestions are not an LLM feature

> "Can I fit a larger dining table?" → "Maximum recommended: 220cm"

An LLM cannot compute this reliably — it will confidently invent clearances. Getting a
correct answer requires a deterministic 2D geometry engine: clearance buffers around
objects, walkway/door-swing zones, collision tests. That's real (though tractable)
engineering, and the spec presents it as if it falls out of the chat feature.

**Recommendation:** two-stage approach.
- **MVP:** a visual clearance overlay in the 2D view — draw configurable buffer zones
  (e.g. 90cm walkways, door swing arcs) and highlight violations in red. The human does
  the reasoning; the tool does the measuring. Cheap and genuinely useful.
- **Later:** expose geometry queries (`max_fit(object, constraints)`,
  `clearance_between(a, b)`) as *tools the LLM calls*, so the chat answer is computed,
  not hallucinated. Never let the LLM emit numbers the engine didn't produce.

### 4. The measurement feature's precision is built on sand

The flagship success criterion is "measure exactly where to place things" — the artwork
example specifies placement to the centimeter. But the input floor plan is admitted to
be "95% accurate." On a 5m wall, 5% is **25cm**. "245cm from the corner" derived from
that plan is a number with false precision; drill the hook and the artwork is
off-center by a hand-span.

**Recommendation:** add a **calibration step** to the import flow. After import, the
app asks the user to tape-measure 2–3 real walls and enter the values; the importer
rescales (per-axis if needed) and reports the residual error. From then on, every
measurement output should carry a confidence band ("245cm ± 3cm") derived from
calibration residuals. This is cheap and converts the feature from plausible-looking to
trustworthy. Without it, the measurement system should not claim cm precision at all.

Also: for a tool whose core value is *what-if visualization* (per Supritha), note that
measurement precision matters less than the spec implies — a useful reframe when
prioritizing.

### 5. A 2D floor plan has no vertical data — and the flagship example needs it

The artwork-hanging example ("bottom: 145cm from floor") and window rendering both
require **heights**: ceiling height, window sill and head heights, door heights,
wall-mounted object heights. None of that exists in a Figma floor plan. The spec
mentions "ceiling height" once and never addresses the rest.

**Recommendation:** make vertical dimensions an explicit one-time manual-entry step per
room/opening after import, with sane defaults (e.g. door 210cm, sill 90cm). Small
feature, but if it's not planned, the 3D view and the artwork use case both quietly
break.

### 6. Figma import: keep it, but formalize it

Since a real plan exists, the importer stays — but as specified it's underdefined.
"Figma Layers → Semantic Objects" only works if layer naming/structure is a *contract*,
not a convention Shyam mostly follows.

- **Export mechanism — recommend a Figma plugin, not SVG.** SVG export flattens
  structure, applies transforms, and forces you to reverse-engineer semantics from
  path geometry. A tiny Figma plugin (they're just TypeScript) walks the real node tree
  — names, positions, sizes, hierarchy — and emits exactly the JSON schema the app
  wants. The Figma REST API is a middle option but needs a token and re-fetching;
  the plugin is simpler and offline-friendly.
- **Write the naming contract down** (one page: how walls, windows, doors, rooms, and
  furniture placeholders must be named/grouped, e.g. `wall:north`, `window:balcony`)
  and make the importer *validate* against it with readable errors, instead of
  silently guessing.
- **Accept that this importer is bespoke.** It serves exactly one Figma file's
  conventions. That's fine for a personal tool — but it argues for keeping the importer
  thin and putting real investment into the app's *own* scene format, so a simple
  built-in wall editor can be added later without the Figma path being load-bearing
  forever.

### 7. Furniture-from-URL extraction: don't scrape

IKEA/West Elm product pages are JS-heavy, bot-hostile, and change layout constantly. A
URL scraper will be broken more often than working.

**Recommendation:** the input should be a **screenshot or photo of the product page**
(plus optional pasted text), run through a vision-capable LLM to extract name/
dimensions/material/color into the object schema — with the dimensions **always shown
for user confirmation before insert**. In a tool whose whole premise is dimensional
accuracy, silently trusting extracted numbers is the one unforgivable failure mode.
This also handles the "custom objects" case with the same flow.

### 8. Chat command layer: spec the hard 20% now

The examples shown are the easy cases. The parts that will actually consume the effort:

- **Object addressing.** "The sofa" — which sofa? Commands need stable object IDs and
  the AI layer needs a disambiguation step ("there are two sofas — the olive one in the
  living room?").
- **Relative spatial references.** "50cm closer to the window" requires resolving
  *which* window, computing the direction vector, and validating the result doesn't
  clip a wall. That's resolver logic in the engine, not the prompt.
- **Validation failures need good UX.** When a command would embed the sofa in a wall,
  the rejection should come back through chat as a sentence, not a silent no-op.

None of this is a reason to cut chat — it's a reason to design the command schema
(IDs, anchors, units, error channel) *before* writing the first prompt.

---

## Platform & stack recommendation

The doc proposes React + Three.js frontend, Node backend, SQLite. **Half of that is
over-engineering for a single-user, single-home, local tool.**

**Recommendation: start as a plain browser web app (Vite + React + Three.js), no
backend, no SQLite.**

- **Storage:** one versioned **JSON project file** per home (File System Access API in
  Chromium, plus plain download/upload fallback; autosave to IndexedDB). A whole-home
  scene is kilobytes. A JSON file is diffable, git-friendly, trivially backed up, and —
  combined with the command log — gives you history/undo for free. SQLite adds a
  schema-migration tax and a runtime dependency for zero benefit at this data size.
- **AI calls:** direct from the browser to the LLM API. For a personal local tool, a
  user-supplied API key in local storage is acceptable; if that feels uncomfortable, a
  ~50-line local proxy is the escape hatch — not a whole Node "orchestration" backend.
- **Impact:** removes packaging, IPC, and DB layers from the MVP entirely; everything
  is one `npm run dev`. The cost is Chromium-only file-handle niceties and no native
  menu bar — irrelevant for a personal tool.
- **Upgrade path:** if a "real app" feel is wanted later, wrapping the same codebase in
  **Tauri** is days of work and adds secure key storage. Deciding that later costs
  nothing; deciding Electron/Node/SQLite now costs weeks.

The `Homes/Rooms/Walls/Objects/...` schema in the doc is still valuable — as the shape
of the JSON scene format, not as SQL tables.

---

## MVP scope: right milestone, wrong internal order

The single-room first milestone is correct. Two adjustments:

1. **Order the work so the scene model comes first and chat comes last.**
   Scene schema → Figma plugin/importer + calibration → 2D editor → 3D view →
   measurement overlay → saved cameras → chat commands. Chat is cheap *once the command
   layer exists*, and worthless before it — building it early means building it twice.
2. **Move out of MVP:** constraint-aware chat answers (replace with the clearance
   overlay), all vision features, image enhancement, and photo verification (replaced
   by the side-by-side viewpoint comparison, which can come right after MVP since it
   reuses saved cameras).

The "must have" list as written (import + rooms + furniture + 2D + 3D + save + cameras
+ measurement + chat) is roughly 6 features deep for a v1. It's achievable, but only if
each one is deliberately thin — the fidelity decision (#1 above) and the platform
decision are what keep it thin.

---

## Open questions for Shyam

1. **Figma file structure:** what are the actual layer/group naming conventions in the
   existing plan? (Needed to write the importer contract — send a screenshot of the
   layer tree.)
2. **Vertical dimensions:** does he have ceiling heights and window sill/head heights
   measured, or should the app's defaults-plus-manual-entry flow assume nothing?
3. **Multi-floor / multi-home:** is this one apartment on one level? (If yes, the scene
   format can skip floors entirely for now — but the JSON schema should leave a slot.)
4. **AI provider & key handling:** direct browser calls with his own API key, or does
   he want the small local proxy?
5. **The rug question, honestly:** when he imagined "what would it look like with a
   darker rug," was he picturing something a colored block can never deliver? If yes,
   the AI image-enhancement path should be promoted from "future/optional" to
   "post-MVP, planned" — because it, not the Three.js viewport, is what will answer
   that question.

---

## Summary of recommended changes to the spec

| Spec item | Verdict | Change |
|---|---|---|
| Command layer architecture | Keep | Add object IDs, anchor resolution, error channel to the schema |
| 2D-edit / 3D-evaluate split | Keep | — |
| Figma import | Keep (confirmed real plan) | Figma **plugin → JSON**, written naming contract, validating importer |
| Measurement system | Keep, fix | Add tape-measure **calibration step** + confidence bands |
| Vertical dimensions | Missing | Add manual heights entry per room/opening with defaults |
| Parametric furniture | Keep | Blocks in MVP; roadmap compound primitives for recognizability |
| Aesthetic what-ifs (`CHANGE_MATERIAL`) | Expectation reset | Works mechanically, looks like nothing until fidelity upgrade or AI enhancement |
| Constraint-aware suggestions | Downgrade | MVP: clearance overlay; later: geometry queries as LLM tools |
| Photo room verification | **Cut** | Replace with photo-vs-render side-by-side at saved viewpoints |
| Furniture from URL | Change input | Screenshot + vision extraction, mandatory dimension confirmation |
| Node backend + SQLite | **Cut from MVP** | Browser app + versioned JSON project file; Tauri later if wanted |
| Chat interface | Keep, resequence | Build last in MVP, after command layer is proven by the UI |

---

## Addendum — response to Shyam's PR comment (2026-07-16)

Shyam answered the open questions and added new requirements in the PR thread. Going
through each, with pushback where warranted (per the brief: don't just accommodate).

### Open questions, answered

**1. Drop the Figma importer; read the file via an MCP session instead.**
Reasonable for a one-off personal project, but be clear about what this actually is:
a **manual, one-time conversion**, not an importer. A Figma MCP session lets an LLM
*look at* the file and describe it — that is not the same as guaranteed numeric
extraction of exact coordinates and dimensions. Two things to verify before relying on
it: (a) that the specific Figma MCP server in use actually exposes precise node
geometry (position/size in the file's coordinate space), not just a visual/textual
summary — if it only gives approximate descriptions, you're back to the 95%-accuracy
problem the calibration step was designed to fix; (b) since this is a manual one-shot,
any future change to the apartment's layout means redoing the session by hand — fine
given "not moving anytime soon," but worth writing down as a known limitation rather
than discovering it later. The JSON scene schema and the calibration step **still
apply** regardless of how the numbers get extracted.

**2. No vertical dimensions — assume nothing.** Confirmed; manual-entry-with-defaults
flow (§5 above) stands as designed.

**3. Single apartment, single level.** Confirmed; scene schema can skip
multi-floor/multi-home for now (leave the slot, don't build the UI).

**4. AI provider: free matters most, local-or-cloud both fine, no major privacy
concern.** This argues for a **provider-abstraction layer**, not a specific provider —
build the command-generation and vision-extraction calls behind a thin interface so the
model/provider is swappable, then default to whichever free tier is currently most
capable. Two things worth flagging: free cloud tiers come with real rate limits that
will bite during active editing sessions, and local models (e.g. via Ollama) are
meaningfully weaker at structured tool-call-style output and vision extraction than
frontier cloud models — the chat command layer and furniture-image extraction are
exactly the features most likely to degrade on a small local model. Recommendation:
cloud free tier as the default, local as an opt-in fallback, never the other way
around, and design the interface so switching is a config change, not a rewrite.

**5. Yes — near-photorealistic renders were the actual ask.** See the fidelity section
below; this reverses part of the original recommendation.

### New requirements

**Multi-user (2 users).** This is a real architectural addition, not a small one — but
point 2 below (version management) turns out to solve it cleanly. See combined
treatment below.

**"Version management for the home" — yes, this makes sense, and it's good news.**
What's being described is a branching model: each person (or the same person) works on
a draft layout, the two of you compare and agree, then one draft becomes "current."
That maps directly onto the command-log architecture already recommended — a "layout"
is just a named sequence of commands from a base state, "current" is a pointer to one
layout, and comparison is a diff over two command sequences (or two resulting scene
snapshots). This also **resolves the multi-user problem** without needing real-time
collaborative editing (which would require CRDTs/OT — genuinely hard, don't build it):
two people editing the same shared JSON project file (synced via whatever file-sync
tool you already use — Dropbox, iCloud, Syncthing) each work on their own named
draft/branch, so they're never editing the same data at the same time, and merging is
an explicit human decision ("let's go with my version"), not an automatic algorithm.
Recommendation: model this explicitly as first-class **layout branches** in the schema
(`layouts: [{name, base, commands[]}]`, `current: layoutId`) from the start — it's a
small addition to the JSON structure and it's much more painful to retrofit than to
design in now.

**Photo-based room verification — dropped, confirmed.** No further action; the
side-by-side viewpoint-comparison replacement stands.

**3D model extraction from photos/video of decor.** Tempting, but **don't build this
in-house** — it's the same class of problem as the room-verification feature that was
just cut (photogrammetry/NeRF/Gaussian-splatting from casual phone capture), except
harder, because now the output needs to be a clean, lightweight mesh that composites
correctly into a scene at exact physical scale — thin lamp arms, upholstery, and glass
are exactly the cases where consumer photogrammetry still falls over. This is also a
solved-elsewhere problem: **use an existing tool's output as an import**, not a
built-in pipeline. Apps like Polycam or Luma AI already do phone-based capture → mesh;
let the user scan a piece of furniture there, export glTF/OBJ, and import it as a
custom object through the same "confirm dimensions before insert" flow already
recommended for URL-sourced furniture. If it's useful later, integrate one of those
providers' APIs — don't reimplement photogrammetry.

**Furniture from URL — confirmed, no scraping, screenshots/descriptions instead.**
Matches the original recommendation; no change needed.

**Chat command layer: sidebar + mention syntax for objects.** This is the right
instinct and it directly answers the "which sofa?" object-addressing problem flagged
earlier. It's a standard, well-understood pattern (Slack/Notion/Linear-style
`@`-mention autocomplete) — recommend generalizing it to a single "reference" token
type that can resolve to *any* addressable scene entity: an object, a camera position,
a material/color property, a room. Critically, **the resolved mention should carry the
entity's stable ID into the message sent to the LLM**, not just its display name — so
disambiguation happens once, at mention-time in the UI (where the user can see the
viewport and pick the right one), and the model never has to guess which "sofa" was
meant. This is a genuinely good design decision and should be locked into the command
schema early.

### Fidelity: partial reversal, with pushback

Section 1's original recommendation (blocks now, compound primitives later) is
revised, but the request as stated — real-time rendering at "RDR2 on PS4" quality — is
**not achievable for this project as a from-scratch build**, and should be pushed back
on directly rather than quietly attempted and under-delivered.

Why: RDR2-level visual quality is the output of a AAA studio's dedicated rendering
team, years of engine work, and a large, hand-crafted, LOD'd asset pipeline. Even
"just" the parts of that quality bar that matter for a room — physically-based
materials, soft shadows, indirect/bounce lighting, screen-space reflections, tone
mapping and color grading, anti-aliasing — is a multi-year specialty even before
counting asset production. That bar is out of reach for a two-person personal tool
regardless of engine choice (Unreal/Unity included), because the bottleneck isn't the
engine, it's the artist-hours of lighting and material tuning per scene.

**What's actually achievable, and recommended:**

1. **A real-time viewport that's honest about being a real-time viewport.** Upgrade
   from flat-color blocks to a "good video-game-editor" look: PBR materials (roughness/
   metalness maps, even simple ones), baked lighting for a fixed room (bake once per
   layout change, not per frame — this is far cheaper than dynamic GI), an environment
   map for ambient light, soft shadow maps, and standard post-processing (SSAO, tone
   mapping, a touch of bloom). This is realistic to build in Three.js or Babylon.js
   with baked lightmaps and gets meaningfully closer to "looks like a game" without
   chasing real-time path tracing. It will not look like RDR2. It will look like a
   competent architectural-visualization tool, which is a legitimate and achievable
   target.
2. **AI-generated stills for the actual photorealism ask.** The original spec already
   had this as a "future" item ("AI Rendering Enhancement" — screenshot in, enhanced
   image out, geometry preserved). Given that Shyam's real want ("what will the room
   look like with this rug and the rest of the decor") is fundamentally a *still-image*
   question, not a *walkthrough* question, this should move from future/optional to a
   **core MVP-adjacent deliverable**: render the current layout from a saved camera,
   send it to an image model with the scene's material/color list as context, get back
   a photorealistic still. This is where the actual "RDR2 quality" feeling comes from
   in this architecture — not the live viewport.
3. **Furniture asset quality follows from this.** A baked-lighting real-time viewport
   makes flat-colored boxes look worse than they did on plain shading, so this is a
   reasonable point to bring forward part of the "later" fidelity roadmap: for known
   catalog items (IKEA in particular publishes some 3D assets; other retailers less
   so), source or approximate real models instead of building compound primitives from
   scratch; fall back to compound primitives + PBR materials for anything custom. This
   is more work than originally scoped for MVP, and should be treated as its own
   milestone after the single-room prototype proves out the rest of the pipeline —
   not bundled into the first build.

Net effect on MVP: the "blocks now, better later" plan becomes "PBR + baked lighting
now, AI-still photorealism as the near-term photorealism answer, real furniture assets
as a follow-on milestone." Real-time ray-traced, game-console-grade rendering is not
recommended at any point in this project's scope — the AI-still path exists precisely
so that ambition doesn't have to be chased in the live renderer.
