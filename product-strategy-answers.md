# Mirror — Answers to the Ten Strategic Questions

Response to Shyam's follow-up questions on PR #1 (merged). These are opinionated
recommendations, not a survey of options — pick a fight with any of them.

---

## 1. Layout tool or visualization tool? Pick one for the MVP.

**Layout-first. Not close.**

These genuinely optimize for different things, and you named the tell yourself:
geometry/measurement/collision work rewards *correctness*, visualization work rewards
*taste*. Correctness is checkable — you can look at a number and know if it's right.
Taste isn't — you can iterate on lighting forever and never know if you're done. A
two-person project that starts by chasing an uncheckable target will stall on it.
Layout-first also matches what actually survived scrutiny in the original review: the
command layer, the measurement/calibration system, and the clearance-overlay idea are
all layout-side, and none of them depend on visualization quality to be useful.

One caveat: **don't build layout-first as if visualization doesn't exist.** The
render-hook has to be a first-class extension point from day one — one saved camera,
one "generate a still" button that's allowed to be a stub — so that when visualization
work starts, it's plugging into a socket, not retrofitting one. Q4 below is where that
socket goes.

---

## 2. Should the viewport use stylized recognizable shapes instead of literal boxes?

**Yes — and this upgrades the original "blocks now" call rather than contradicting
it.** The original review's "later" item (compound parametric primitives) should move
to v1, because the cost is lower than it sounds and the payoff compounds.

Concretely: a small taxonomy of maybe 10 furniture archetypes (sofa, armchair, dining
chair, table, bed, cabinet, shelf, lamp, rug, artwork), each a **parametric silhouette
generator** — a sofa is a seat box + backrest slab + two arm bolsters + four tapered
legs, all still driven by the same width/depth/height numbers already in the schema.
This is geometry code, not asset creation — no modeling software, no file assets,
still 100% procedural and dimensionally exact. It costs maybe 2–3 days per archetype
category the first time the pattern is built, then it's mostly parameter tuning.

Why this matters beyond looking nicer: it also **feeds Q4 directly**. A depth/silhouette
map generated from a recognizable chair shape gives an AI image model something to
condition on that actually looks like a chair. A depth map generated from a box gives
it a box. If AI stills are the real visualization payoff (they are — see Q4), this is
upstream infrastructure for that, not just polish.

---

## 3. JSON file or a real database — is a world model inevitable?

**Stay file-based, but stop thinking of it as "JSON vs. SQLite" and start thinking of
it as source-of-truth vs. derived index.**

The list you gave — objects, layouts, branches, measurements, scenarios, cameras,
metadata, inventories — is a lot of *structure*, but structure isn't what forces a
database. Databases earn their cost when you need concurrent multi-writer access,
transactional consistency across processes, or ad-hoc queries across a dataset too
large to hold in memory. None of those apply here: one home, one or two users editing
serially (not concurrently — see the branches/scenarios answer below), and a home's
entire object graph is comfortably kilobytes to low megabytes.

What *does* force something database-shaped is Q7 — reasoning queries like "find every
place this bookshelf fits" or "which layout maximizes seating." Those want indexed,
queryable structure. The answer isn't to make JSON the query engine — it's to keep
JSON (or similar) as the **canonical, portable, diffable, git-friendly source of
truth**, and when reasoning queries actually need it, build an **embedded, rebuildable
index** (SQLite is fine here, used as a materialized view, not as the database of
record) that's regenerated from the JSON on load or on write. If the index ever gets
corrupted or the schema changes, you delete it and rebuild it from the JSON — you never
migrate it. This gets you query power without ever risking "the database is the only
copy of the truth" — which matters a lot for a local-first tool where the whole pitch
is that the user owns their data as a plain file.

**Answer: stay file-based indefinitely as the source of truth. Add an embedded query
index only when Q7-style reasoning features actually need one, and treat it as
disposable/regeneratable, never authoritative.**

---

## 4. Should the realtime viewport just be an editor, with AI stills as the real
   visualization product?

**Yes, and this is probably the single most important architectural call in this
whole document.** It's the thing that makes the fidelity ambition ("RDR2 quality")
achievable at all instead of a standing scope risk. Endorsing the workflow as drawn:
arrange → preview → choose camera → generate photoreal render → decide.

One technical addition worth locking in now: **don't feed the AI model a plain
screenshot and ask it to "enhance" it.** Plain image-to-image enhancement on a
screenshot tends to drift — the model will happily reinterpret proportions, move a
window, invent a doorway. Instead, condition the generation on a **depth map or edge/
normal map rendered directly from the 3D scene** (structurally-conditioned generation,
the same family of technique as ControlNet-style conditioning), plus a text description
of materials/colors pulled from the scene's own material properties. This is the
difference between "AI reimagines your room" and "AI renders your room" — the latter is
what preserves the geometry the review's original "accuracy over realism" principle
insists on, and it's exactly what Q2's silhouette geometry was setting up: better input
shapes produce a better-conditioned, more faithful still.

This also directly answers Q8 (fidelity budget) — see below.

---

## 5. Digital twin, or spatial reasoning engine?

**Both, but not simultaneously — one is the foundation, the other is the ambition, and
conflating them in the pitch is what would overclaim the MVP.**

A spatial reasoning engine needs a model of the space to reason over. You can't ship
"which wall can hold this artwork?" without first having walls, artwork dimensions, and
clearance rules as structured data — which is precisely what the digital twin *is*.
So: **the digital twin isn't a lesser, earlier version of the product — it's the data
substrate the reasoning engine runs on.** Undersell it as "just a twin" and you're
right that it sounds passive; but oversell it as "a reasoning engine" before the twin
exists and you're promising queries over data you haven't built yet.

Practical implication: build the digital twin, but design its schema like a reasoning
engine's substrate from day one — real object IDs, real dimensions, real material/color
fields, real clearance semantics — even though nothing queries it yet. The trap to
avoid is building the twin as a "pretty picture" data model (just enough structure to
render) and discovering later that answering "find every place this fits" requires a
schema rewrite. Store more structure than the MVP UI uses; expose less of it than you
store.

---

## 6. Should Scenarios be the primary organizational unit, replacing linear version
   history?

**Yes — and it unifies cleanly with the layout-branch idea from the previous PR rather
than replacing it.** Branches and scenarios are the same underlying primitive with
different *intent*:

- A **draft/branch** is transient — two people trying variations on the way to picking
  one "current" layout. It's expected to converge and get archived or discarded.
- A **scenario** is durable — "Movie Night," "Hosting," "Christmas" are configurations
  you deliberately keep and switch back to, not steps toward a single answer.

Don't build two systems. Build **one graph of named layouts**, each with a parent/base
reference and a set of changes from that base, and a `role` tag: `draft`, `scenario`,
or `current`. Comparison ("compare Movie Night with Hosting") is the exact same diff
operation as comparing two drafts — it doesn't care what the tag says. This also
answers Q6's own point about the chat interface for free: "compare Movie Night with
Hosting" and "compare version 12 with version 15" become the same command with
different arguments, once layouts are addressable by name instead of only by number.

Recommend `Scenarios` become the user-facing primary noun in the UI (it's the
human-legible one), with drafts/branches as an implementation detail mostly invisible
until two people are actively mid-disagreement about a layout.

---

## 7. Should Mirror reason about the space, not just edit it?

**Yes, this is the correct long-term direction — but it's not a new feature, it's the
payoff of infrastructure the layout-first MVP already has to build for a different
reason.** "Find every place this bookshelf fits," "which wall can hold this artwork,"
"which layout maximizes seating" are all queries over the same **deterministic
geometry engine** — collision detection, clearance rules, wall-space calculation — that
the original review already flagged as required for constraint-aware suggestions (the
"can I fit a bigger dining table?" example) and the clearance-overlay MVP feature.

The sequencing that matters: **build the geometry query engine once, as real code, then
let two different surfaces sit on top of it** — a deterministic UI overlay for the
layout-tool use cases (Q1), and a set of callable functions the LLM can invoke for the
natural-language reasoning use cases (Q7). The one rule that can't be broken: the LLM
is *allowed to call* `find_wall_space()` or `max_fit(object, room)`, and to phrase the
result conversationally — it is never allowed to compute or invent the number itself.
This was true for "can I fit a larger table" in the original review; it's exactly as
true for "find every place this bookshelf fits." Reasoning is a bigger, more ambitious
version of the same architectural constraint, not a different one.

---

## 8. One week to spend on realism — where does it go?

Ranked, given the decisions above (viewport is an editor, AI stills carry
photorealism):

1. **The AI-still pipeline itself** — specifically, getting depth/structure-conditioned
   generation working well (Q4), with material/color context passed in accurately.
   This is the actual "wow" surface. It's also the one line item that can plausibly get
   you toward "RDR2-quality" perceived output without ever touching a real-time
   renderer's engine internals.
2. **Silhouette geometry (Q2) and camera framing together.** These are cheap and they
   both compound into #1: better shapes condition better stills, and a well-chosen
   camera angle affects perceived quality more than render fidelity does — this is
   just true of photography and archviz alike, a mediocre render from a good angle
   beats a great render from a bad one.
3. **Materials in the realtime viewport.** Lower priority than it sounds, because most
   of this effort is thrown away the moment AI stills exist — you'd be polishing the
   editor, not the product.
4. **Realtime lighting (baked GI, soft shadows, etc.).** Lowest priority of the four.
   Nice-to-have for the editor feeling less flat, but it is the least connected to the
   actual photorealism goal — spend the week elsewhere first.

---

## 9. Should objects accumulate history and provenance, not just geometry?

**Yes, and it's cheap enough to add the schema slot now even though nothing uses it
yet.** A lightweight, mostly-free-text "dossier" per object — purchase date, price,
material, notes, which scenarios it appears in, prior locations — costs almost nothing
to add as an open metadata field today, and becomes expensive to retrofit later if the
schema wasn't built to hold it (every existing object would need a migration).

Two things worth being disciplined about: don't build UI for this in the MVP — it's a
schema decision, not a feature to ship yet — and let "previous locations" and
"scenario membership" fall out naturally from Q6's layout graph rather than being
separately tracked, since an object's location history is really just "which layouts
reference this object, and where does each one place it."

---

## 10. The one-sentence definition

Of the four, **closest is C, but I'd tighten it.** Ruling out the other three
explicitly:

- **A ("a digital twin of my home")** undersells it per Q5 — accurate but passive, and
  it invites scope creep toward "twin fidelity" (the RDR2 conversation) as the whole
  point, which Q4 already redirected elsewhere.
- **B ("an AI-powered interior design tool")** overclaims in the wrong direction —
  it's marketing language that implies aesthetic/taste-first, which directly
  contradicts the Q1 decision to be layout-first. It also undersells the measurement/
  geometry rigor that's the actual differentiator versus every existing design app.
- **C ("a spatial reasoning engine for experimenting with my home")** is directionally
  right but reads as abstract/enterprise-AI-jargon on its own, and "reasoning engine"
  as a phrase doesn't obviously mean anything to a future collaborator or to Shyam's
  partner if they read it cold.

**Recommended phrasing:** *"A structured, accurate model of your home that lets you
plan, compare, and decide changes before you make them physically."* This keeps C's
spirit — action-oriented, not just descriptive — but anchors it in three concrete verbs
(plan, compare, decide) instead of the word "reasoning," and it doubles as a scope
filter: any proposed feature should visibly serve one of those three verbs, or it's
scope creep. ("Realistic ray tracing" serves none of the three — that's exactly why the
fidelity pushback in the original review holds.)
