# Proposal: location-driven sun/lighting — improvements-minor-fixes §9

**Status:** approved for build (2026-07-22 review) — **hour + date** input
confirmed (§2's open question), per this doc's own recommendation: the date
field defaults to today's date, capturing the seasonal sun-height swing
rather than shipping a control that's only correct one season a year.
Scope (toggle-not-replacement, raw lat/long, separate orientation input,
basic form styled per `cohere/DESIGN.md`) is already resolved by Shyam
(2026-07-22, `improvements-minor-fixes.md` §9); this document brings back the
solar-position math, the concrete input-form design, and the schema shape so
an implementer can build directly. Two things are deliberately left as
Shyam's confirm, not silently decided: **time-of-day granularity** (§2) and a
short list of render-time edge calls (§6).
**Date:** 2026-07-22
**Scope frame:** derive the sun's azimuth/elevation from lat/long + date +
time entirely client-side (no network, per CLAUDE.md's standing "only network
call is fal.ai" decision), map that onto scene coordinates via a room
orientation input, and feed the result into the **existing** render path as an
alternate *source* for the two numbers the sun already consumes. Coexists with
the manual sliders behind a mode toggle. Commits to nothing about lamp/fixture
lighting (that is §4b, separate and unscoped).

## Problem

Sun angle is manual today. `LightingPanel.tsx` exposes `sunAzimuthDeg` /
`sunElevationDeg` / `sunIntensity` / `hemisphereIntensity` as sliders, stored
in `LightingSchema` (`scene.ts:143`) and reconstructed into a world-space sun
position by `sunPositionFromAngles(az, el, target)` in `buildScene.ts:425`.
That is fine for "make it look good," but it can't answer "what does this room
actually look like at 9am in December, given where the building faces." Shyam
wants to drive azimuth/elevation from a real location + clock instead —
without giving up the manual sliders (§9: "coexists as a toggle").

The good news, architecturally: the render path already speaks
azimuth/elevation. `sunPositionFromAngles` is the single seam both the initial
build and Viewport's live lighting effect go through (`buildScene.ts:419–438`
comment). So **location mode is not new rendering — it is a new source for two
numbers the renderer already consumes.** The work is (a) a pure solar-position
function, (b) an orientation transform from compass space into the scene's
`atan2(x, z)` azimuth convention, (c) a small input form, and (d) a schema
field + a mode selector. No shader work, no new light objects.

## Recommendation (summary)

1. **Solar math — hand-roll the NOAA low-precision algorithm as one small pure
   local util (`src/util/solarPosition.ts`), do not add an npm dependency.**
   ~40 lines of trig, accurate to well under a degree — orders of magnitude
   more precision than architectural sun-angle viz needs. A dependency (even
   tiny SunCalc) buys nothing here and adds a supply-chain surface that cuts
   against this repo's deliberately minimal, offline-first footprint (§1).
2. **Time-of-day — recommend hour + date (date defaulting to today), but this
   is explicitly Shyam's call** (§2). Hour-only is simpler UI but bakes in one
   season's sun height; hour+date costs one extra field and captures the
   winter-low/summer-high variation that is often the whole point of the
   feature.
3. **Input form — three plain fields: two number inputs (lat, long) + one
   orientation control, reusing the app's existing `<label><span>` +
   `type="number"`/`<select>` idiom, no bespoke UI.** For orientation, recommend
   a **degree number field (0–359) as the precise primary control, with a
   16-point compass `<select>` beside it as a quick-set convenience** that just
   writes the same degree value. A draggable compass-rose SVG is the explicit
   v2 upgrade, out of scope for "keep it basic" (§3).
4. **Schema — a new room-level `location` object + a `lightingMode` enum,
   both optional, both separate from `LightingSchema`, no `SCHEMA_VERSION`
   bump.** Absent `lightingMode` ⇒ manual ⇒ old files render pixel-identical to
   today. Mirrors the `locked` / `room.shell` additive-optional precedent
   exactly (§4).

## 1. Solar-position formula

### 1.1 The survey

| Option | What it is | Verdict |
|---|---|---|
| **NOAA SPA (full)** | The reference "Solar Position Algorithm" (Reda & Andreas), accurate to ±0.0003°. | Rejected — hundreds of lines, ephemeris tables. Absurd overkill for lighting a room. |
| **NOAA low-precision (ESRL spreadsheet algorithm)** | The widely-reproduced ~40-line version behind NOAA's public solar calculator. Accurate to ~0.01–0.1° for dates near now. | **Recommended — hand-roll it.** |
| **SunCalc (mourner/suncalc)** | ~120-line MIT single file, zero sub-deps, `getPosition()` → `{azimuth, altitude}`. Astronomically it *is* essentially the same low-precision math. | Viable but not recommended — see below. |
| **astronomy-engine / other npm** | Heavier, higher-precision libs. | Rejected — same overkill as SPA, plus a dependency. |

**Recommendation: hand-roll the NOAA low-precision algorithm as a local pure
module, no dependency.** Reasoning:

- **Precision is a non-issue.** Sub-degree accuracy is invisible when the
  output drives a directional light over a room; even a whole degree of sun
  azimuth is imperceptible in the render. Every option on the list is more than
  accurate enough, so the tiebreaker is cost, not accuracy.
- **A dependency is the wrong trade here.** This repo runs on a deliberately
  small dependency set (`package.json`: nine runtime deps, zero
  astronomy/solar) and a standing "only network call is fal.ai" rule. Pulling
  in a package — even a 4KB MIT one — for ~40 lines of trig adds a
  supply-chain/update surface for no functional gain. Vendoring SunCalc's one
  function (copying the file with its MIT header) is the *middle* option and is
  acceptable if the implementer would rather not transcribe trig; but the math
  is short and well-documented enough that a first-party util is cleaner and
  fully auditable.
- **It's pure and testable.** A `(lat, lng, date) → {azimuthDeg, elevationDeg}`
  pure function is trivially unit-tested against NOAA's published calculator
  for a few known city/date/time triples — which is exactly how the
  implementer should validate it.

### 1.2 The formula shape (build directly from this)

`src/util/solarPosition.ts`, one pure function. All intermediate angles in
radians; convert at the boundaries.

```
solarPosition(latDeg, lngDeg, when: Date, tzOffsetHours) ->
    { azimuthDeg,   // 0 = due NORTH, increasing CLOCKWISE (90 = E, 180 = S, 270 = W)
      elevationDeg  // angle above the horizon; negative = sun is below the horizon (night)
    }
```

NOAA low-precision steps (each line is one assignment; `sin`/`cos` in radians,
angles reduced mod 360 where noted):

```
1.  Julian Day  JD   from the calendar date + fractional time (UT).
2.  Julian Century  T = (JD - 2451545.0) / 36525
3.  Geom. mean longitude   L0 = (280.46646 + T*(36000.76983 + 0.0003032*T)) mod 360
4.  Geom. mean anomaly      M  = 357.52911 + T*(35999.05029 - 0.0001537*T)
5.  Eccentricity            e  = 0.016708634 - T*(0.000042037 + 0.0000001267*T)
6.  Sun equation of center  C  = sin(M)  * (1.914602 - T*(0.004817 + 0.000014*T))
                               + sin(2M) * (0.019993 - 0.000101*T)
                               + sin(3M) *  0.000289
7.  True longitude   Ltrue  = L0 + C
8.  Apparent long.   lambda = Ltrue - 0.00569 - 0.00478*sin(125.04 - 1934.136*T)
9.  Mean obliquity   eps0   = 23 + (26 + (21.448 - T*(46.815 + T*(0.00059 - 0.001813*T)))/60)/60
10. Obliquity corr.  eps    = eps0 + 0.00256*cos(125.04 - 1934.136*T)
11. Declination      decl   = asin( sin(eps) * sin(lambda) )
12. Equation of time (minutes):
        y = tan^2(eps/2)
        eqTime = 4 * deg( y*sin(2*L0) - 2*e*sin(M) + 4*e*y*sin(M)*cos(2*L0)
                          - 0.5*y*y*sin(4*L0) - 1.25*e*e*sin(2*M) )
13. True solar time (min) = localClockMinutes + eqTime + 4*lngDeg - 60*tzOffsetHours
14. Hour angle    H (deg) = trueSolarTime/4 - 180     (wrap into -180..180)
15. Zenith:   cos(zenith) = sin(lat)*sin(decl) + cos(lat)*cos(decl)*cos(H)
              elevationDeg = 90 - deg(acos(clamp(cos(zenith), -1, 1)))
16. Azimuth (from north, clockwise):
        cosAz = (sin(lat)*cos(zenith) - sin(decl)) / (cos(lat)*sin(zenith))
        az    = deg(acos(clamp(cosAz, -1, 1)))
        azimuthDeg = (H > 0) ? (az + 180) mod 360 : (540 - az) mod 360
```

(Atmospheric-refraction correction to elevation exists in the full NOAA sheet;
skip it — it's a fraction of a degree near the horizon and irrelevant here.)

**On `tzOffsetHours` — recommend deriving it, not asking for it.** Step 13
needs the timezone to turn a local clock reading into true solar time. Rather
than add a fourth input field, derive it from longitude:
`tzOffsetHours = round(lngDeg / 15)`. This is off from civil time by up to ~30
min near timezone boundaries and ignores DST, both of which shift the *clock
label* on a given sun position by well under an hour — negligible for
sun-angle viz, and it keeps the form to lat/long/orientation/time with no
timezone UI. (If Shyam later wants the clock to read as true civil time, an
explicit optional `timezoneOffsetHours` field can be added without reshaping
anything — see §4. Flagged in §6.)

### 1.3 Mapping solar azimuth onto the scene

The solar azimuth from §1.2 is a **compass bearing** (clockwise from
geographic north). The scene's sun uses a *different* convention:
`buildScene.ts:425` derives position via `atan2(x, z)`, i.e. **0° = +Z, 90° =
+X** (see the `DEFAULT_SUN_AZIMUTH_DEG` derivation, `scene.ts:125–139`). The
room's axes are not compass-aligned — that's exactly why §9 calls for a
separate orientation input. The transform:

```
sceneAzimuthDeg = (solarAzimuthDeg - orientationDeg)  wrapped into 0..360
```

where `orientationDeg` is **the compass bearing that the scene's +Z axis
points** (0 = +Z faces north, 90 = +Z faces east). Elevation needs no
transform — it's horizon-relative and orientation-independent:
`sceneElevationDeg = solarElevationDeg`.

> **Sign caveat the implementer must pin down empirically.** The scene's
> `atan2(x, z)` handedness in plan view and the chosen sign of `orientationDeg`
> have to agree. Rather than assert a sign I can't verify from the math alone,
> validate it: set orientation so +Z faces due south, pick local solar noon,
> and confirm the sun lands over the room's south side (long shadows pointing
> north). If it comes out mirrored, flip to `(orientationDeg - solarAzimuthDeg)`
> — it's a one-line correction, but it must be confirmed against a render, not
> assumed. A unit test asserting a couple of known noon positions locks it.

Then location mode simply calls the **existing**
`sunPositionFromAngles(sceneAzimuthDeg, clampedElevation, target)` — the same
function manual mode uses. Nothing downstream changes.

## 2. Time-of-day input — OPEN, Shyam's call

The doc flags this explicitly, so I present it plainly rather than deciding it.

- **Hour-only against a fixed date.** One control (an hour field or slider,
  0–24). Simplest UI. **Cost:** the sun's *height* at a given hour depends on
  the date — the noon sun is far lower in December than in June. Pinning a
  fixed internal date means every hour reads at that one season's elevation, so
  "3pm" is only correct for that season and visibly wrong the rest of the year.
- **Hour + date.** Two controls (hour + a date field). **Cost:** one extra
  input. **Benefit:** captures the seasonal elevation swing — which, for
  someone modeling how real daylight falls through a specific building, is
  frequently the entire reason to want location-driven sun in the first place.

**Recommendation (soft): hour + date, with the date field defaulting to
today's date.** The marginal UI cost is a single field, and the seasonal sun
height is a large, meaningful, visible effect — not a rounding error. Hour-only
would ship a control that is quietly wrong two-thirds of the year. But per §9's
instruction this is **flagged as Shyam's call to confirm, not decided here** —
if he'd rather ship hour-only first and add date later, the schema in §4 holds
both (`date` is optional; absent ⇒ hour-only against a fixed reference date),
so starting hour-only and adding the date field later is a non-breaking change.

## 3. Concrete input form design

This is the part §9 most wants designed. Everything below reuses the app's
existing form idiom — `<label className="…-field"><span>Label</span><input…/>`
(see `ObjectEditFields.tsx:75–88`, `ImportPanel.tsx:183–205`) — so it inherits
`cohere/DESIGN.md`'s form-field language for free: soft-stone grouping rows
(`--color-soft-stone`, `--radius-sm`), `--text-body` labels at the muted body
color, and the focus-ring treatment already in `LightingPanel.css:62–66`
(colored border + 2px glow, DESIGN.md §5 "form fields: focus = colored border
+ glow ring"). No new visual vocabulary is invented.

### 3.1 Where it lives

Inside the existing **Lighting** tab (`App.tsx:409`), the `LightingPanel`. Add
a mode toggle at the top; render the location fields when location mode is
active, the existing sliders when manual. This keeps all sun controls in one
place and makes the "coexists as a toggle" decision literal — one panel, one
toggle, two field-sets.

```
Lighting
  ( ) Manual    (•) By location          <- mode toggle (radio pair / segmented)
  ────────────────────────────────────
  [ manual mode: the existing 4 sliders, unchanged ]
    — or —
  [ location mode: the fields below ]
      Latitude   [   40.7128 ]   °N+     <- number field
      Longitude  [  -74.0060 ]   °E+     <- number field
      Room faces [ 135 ] °   [SE ▾]      <- degree field + 16-pt quick-set select
      Time       [ 09:00 ]               <- hour (see §2)
      Date       [ 2026-07-22 ]          <- date (see §2; omit if Shyam picks hour-only)
      ↳ small hint: computed sun 118° / 34° above horizon
```

The mode toggle itself is a plain radio pair or a small segmented control in
the app's existing style — no bespoke widget. Recommend a labelled radio pair
(`Manual` / `By location`) for zero ambiguity and zero new CSS.

### 3.2 Latitude / longitude fields

Two `<input type="number">` fields, decimal degrees, **N/E positive** (the
universal sign convention; a hint line states it). `min`/`max` −90..90 and
−180..180 with `step` fine enough for city precision (e.g. `0.0001`). Same
validation-on-the-field shape `ObjectEditFields` already uses (it flags invalid
dims inline). Decimal degrees, not degrees-minutes-seconds — it's what map apps
and GPS give, and it's one field each.

### 3.3 The orientation control — the real design question

Options weighed:

| Option | Pro | Con |
|---|---|---|
| **(a) Plain degree number field (0–359)** | Precise; trivially maps to the schema value; pure app idiom. | Users don't think in bearings — "what degree does my apartment face?" is hard to answer without a compass app. |
| **(b) Compass-point `<select>` (8 or 16 points)** | Matches how people describe a home ("faces southeast"); a plain `<select>`, already the app's idiom (`ImportPanel`, `ObjectEditFields` both use them); zero bespoke design. | Coarse — 45° (8-pt) or 22.5° (16-pt) granularity; a room rarely faces an exact compass point. |
| **(c) Draggable rotated compass-rose SVG** | Best spatial feedback — literally "point the rose the way the room faces"; visually shows the mapping. | Bespoke component (drag state, raycast/angle math, its own styling). Directly against §9's "keep the input UI basic for v1." |

**Recommendation: (a) + (b) together — a degree number field as the precise
primary, with a 16-point compass `<select>` beside it as a quick-set.**
Selecting `SE` writes `135` into the degree field; the user can then nudge the
number if they know the exact bearing. This gives the intuitive entry people
actually want (b) *and* full precision (a), for the cost of a `<select>` whose
`onChange` sets a number — no bespoke UI, nothing that violates "keep it
basic." Both controls write the **same** `orientationDeg` schema value (§4), so
the control choice never leaks into stored data.

Option (c), the draggable rose, is the natural **v2 polish** — noted here so
it's on record, explicitly out of scope now. If Shyam would rather ship even
leaner, dropping to (b)-only (the `<select>` alone, at 22.5° granularity) is a
fine v1 floor: 22.5° of orientation error is a visible but tolerable sun-angle
shift for a PoC. Recommend shipping (a)+(b); flag the (b)-only fallback as
available.

A one-line hint states the convention plainly: *"Compass direction the room's
back (+Z) wall faces — 0° = north, 90° = east."* (The exact reference axis
wording should match whatever the implementer confirms in §1.3's calibration.)

### 3.4 Live readout

Reuse `LightingPanel`'s existing "instant visual, debounced commit" split
(`LightingPanel.tsx:20–31`) — as the user edits lat/long/orientation/time, show
the **computed** sun azimuth/elevation in a small hint line and drive the
Viewport live, committing through the same debounced `onChange`/autosave path
the sliders already use. This makes the abstract numbers legible ("oh, that
puts the sun low in the west") without any extra machinery.

## 4. Schema shape

Follows the `object-categories.md` / `locked` / `room.shell` precedent
precisely: **additive, optional, no default that rewrites legacy data, no
`SCHEMA_VERSION` bump.** A file with no `lightingMode` and no `location`
validates unchanged and renders exactly as today.

### 4.1 New sub-schemas (module scope, next to `LightingSchema`)

```ts
// improvements-minor-fixes §9: selects where the sun's azimuth/elevation come
// from. "manual" = the LightingSchema sliders (today's behavior). "location"
// = derived from `room.location` via the NOAA solar calc + orientation
// transform, fed into the SAME sunPositionFromAngles path. An enum, not a
// boolean, so a future third source (e.g. an animated time-lapse) is additive.
export const LightingModeSchema = z.enum(["manual", "location"]);
export type LightingMode = z.infer<typeof LightingModeSchema>;

// The location inputs. Separate from LightingSchema on purpose: LightingSchema
// holds the *resolved* render params (azimuth/elevation/intensities); this
// holds the *source* facts (where/when/which-way-the-room-faces) that location
// mode computes azimuth/elevation FROM. Keeping them separate means switching
// modes never destroys the other mode's data — the manual slider values and
// the location facts both persist, and the toggle just chooses which feeds the
// sun. `.loose()` for forward-compat notes, matching every sibling schema.
export const LocationSchema = z
  .object({
    latitudeDeg: z.number().min(-90).max(90),
    longitudeDeg: z.number().min(-180).max(180),
    // Compass bearing the scene's +Z axis faces (0 = north, clockwise). The
    // orientation input; NOT compass-aligned to the scene by default, which is
    // the whole reason §9 calls for a separate field. Both the degree entry
    // and the compass-point <select> write this one number (see proposal §3.3).
    orientationDeg: z.number(),
    // Local clock hour, 0..24 (fractional allowed for half-hours). See §2.
    timeOfDayHour: z.number().min(0).max(24),
    // ISO YYYY-MM-DD. OPTIONAL by design: present => hour+date (seasonal sun
    // height correct); absent => hour-only against a fixed reference date (§2).
    // Making it optional is what lets "hour-only first, add date later" be a
    // non-breaking change if Shyam picks that path.
    date: z.string().optional(),
    // OPTIONAL escape hatch: if set, overrides the longitude-derived timezone
    // (round(lng/15)) the solar calc uses by default (§1.2). Absent => derived.
    timezoneOffsetHours: z.number().optional(),
  })
  .loose();
export type Location = z.infer<typeof LocationSchema>;
```

### 4.2 Additions to `RoomSchema` (`scene.ts:152`)

```ts
export const RoomSchema = z.object({
  ceilingHeightCm: z.number(),
  floor: z.array(FloorRect),
  walls: z.array(WallDefSchema),
  shell: ShellCalibrationSchema.optional(),
  lighting: LightingSchema.optional(),        // unchanged — the manual params
  lightingMode: LightingModeSchema.optional(), // absent => "manual" (back-compat)
  location: LocationSchema.optional(),         // absent => location mode unavailable until set
});
```

### 4.3 Semantics, defaults, migration

- **`lightingMode` absent ⇒ `"manual"`.** No schema `.default()` — a `.default`
  would fire at parse time and stamp every legacy file to an explicit value,
  destroying the "never set" signal, exactly the mistake `object-categories.md`
  §1 calls out for `category`. Consumers read `room.lightingMode ?? "manual"`.
  This is what guarantees old files render pixel-identical to today.
- **`location` absent ⇒ location mode has nothing to compute from.** The UI
  should keep the toggle on manual (or disable the "By location" option) until
  the user fills lat/long. Switching to location mode without a `location` is a
  UI-guarded state, not a schema error.
- **No `SCHEMA_VERSION` bump, `migrate()` untouched** — purely additive
  optionals, identical to the `room.shell` reasoning (`scene.ts:82–92`) and the
  `locked`/`category` precedent. A `v1` file with neither field validates and
  behaves exactly as before.
- **Location mode does NOT overwrite `LightingSchema`.** When mode is
  `"location"`, `buildScene`/Viewport compute `sceneAzimuthDeg`/`elevation`
  from `location` at render time and pass them to `sunPositionFromAngles`,
  *leaving `room.lighting`'s stored slider values intact*. Toggling back to
  manual restores them untouched. Intensities are a sub-question — see §6.

## 5. What this deliberately does NOT do (non-goals)

- **No geocoding, no network.** Raw lat/long only, per §9 and CLAUDE.md's
  standing decision. No place-name lookup, no timezone API, no map tile — the
  timezone is derived arithmetically from longitude (§1.2).
- **No replacement of the manual sliders.** They stay, fully functional, behind
  the toggle (§9).
- **No new light objects or shader work.** Location mode reuses the existing
  single directional "sun" and the `sunPositionFromAngles` seam. Lamp/fixture
  point-lights are §4b — separate, unscoped, untouched here.
- **No animation / time-lapse.** One instant (hour, date) → one sun position.
  A "sweep the day" animation is a plausible later feature the `LightingMode`
  enum leaves room for, but it is not built or designed here.
- **No draggable compass-rose UI in v1** (§3.3) — degree field + `<select>`
  only; the rose is explicit v2.
- **No sub-degree precision chase.** The NOAA low-precision math is the ceiling;
  no SPA, no refraction correction (§1.1).

## 6. Open questions for Shyam

1. **Time-of-day: hour-only or hour+date?** (§2) The one genuinely open input
   decision. Recommendation is hour+date (date defaults to today) — one extra
   field for the seasonal sun-height variation that is often the whole point.
   But hour-only is a legitimate leaner v1 and the schema supports adding date
   later without a break. **Your call to confirm.**
2. **Night / sun-below-horizon behavior.** The manual elevation slider is
   clamped to 5–85° for shadow-frustum reasons (`LightingPanel.tsx:71–73`). A
   real computed sun can sit below 5°, or below the horizon entirely (night).
   What should location mode render then — clamp elevation to 5° and just dim,
   fade the sun toward zero intensity below the horizon and lean on the
   hemisphere ambient (a plausible "dusk/night" look), or hold at the horizon?
   Recommendation: clamp the *shadow* elevation to ≥5° but scale sun intensity
   down as true elevation drops through 0, so night reads dark without breaking
   shadows. Flagging because it's a visible behavior choice, not a math fact.
3. **Does location mode also drive intensity, or only angle?** Simplest: it
   drives only azimuth/elevation and keeps `sunIntensity`/`hemisphereIntensity`
   from the manual sliders (so you still set brightness by hand). More
   physically-honest: intensity also falls with sun elevation (dimmer near
   sunrise/sunset). Recommendation: **angle-only for v1** (keeps the feature
   small and the intensity sliders meaningful in both modes); elevation-driven
   intensity is a clean follow-up tied to Q2's night behavior. Confirm.
4. **Timezone: derive from longitude, or expose a field?** Recommendation is
   derive (`round(lng/15)`, no UI, §1.2) — the error only mislabels which clock
   hour a sun position corresponds to, by under an hour, invisibly for viz. The
   schema keeps an optional `timezoneOffsetHours` override if you ever want the
   clock to read true civil/DST time. Fine to derive-only for v1?
5. **Orientation control: degree-field + compass `<select>`, or `<select>`
   only?** (§3.3) Recommendation is both (precise + intuitive, still basic).
   The leaner floor is the 16-point `<select>` alone at 22.5° granularity.
   Either is "basic" per §9 — which do you want?
