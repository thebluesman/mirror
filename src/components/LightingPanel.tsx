import { useEffect, useState } from "react";
import { DEFAULT_LIGHTING, type Lighting, type LightingMode, type Location } from "../schema/scene";
import { sceneSunAnglesFromLocation } from "../util/solarPosition";
import { useDebouncedCallback } from "../util/useDebouncedCallback";
import "./LightingPanel.css";

// Same debounce shape as ShellPanel's/ImportPanel's tint control — range
// inputs fire onChange on every pixel of drag, and each commit here writes
// through App.tsx's updateLighting (setSceneFile + saveProjectDebounced), so
// an undebounced drag would autosave once per mouse-move.
const SLIDER_DEBOUNCE_MS = 120;

// improvements-minor-fixes §9 (docs/proposals/location-lighting.md §3.3): a
// 16-point compass, each entry writing the SAME `orientationDeg` schema
// value the precise number field writes — the select is a quick-set
// convenience, not a separate source of truth.
const COMPASS_POINTS: { label: string; deg: number }[] = [
  { label: "N", deg: 0 },
  { label: "NNE", deg: 22.5 },
  { label: "NE", deg: 45 },
  { label: "ENE", deg: 67.5 },
  { label: "E", deg: 90 },
  { label: "ESE", deg: 112.5 },
  { label: "SE", deg: 135 },
  { label: "SSE", deg: 157.5 },
  { label: "S", deg: 180 },
  { label: "SSW", deg: 202.5 },
  { label: "SW", deg: 225 },
  { label: "WSW", deg: 247.5 },
  { label: "W", deg: 270 },
  { label: "WNW", deg: 292.5 },
  { label: "NW", deg: 315 },
  { label: "NNW", deg: 337.5 },
];

/** Nearest compass point to an arbitrary degree value — purely a display
 *  convenience for the `<select>` (proposal §3.3); the number field carries
 *  the real precision. */
function nearestCompassDeg(deg: number): number {
  const normalized = ((deg % 360) + 360) % 360;
  let best = COMPASS_POINTS[0];
  let bestDelta = Infinity;
  for (const point of COMPASS_POINTS) {
    const delta = Math.min(Math.abs(point.deg - normalized), 360 - Math.abs(point.deg - normalized));
    if (delta < bestDelta) {
      bestDelta = delta;
      best = point;
    }
  }
  return best.deg;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO YYYY-MM-DD for the given date, read in LOCAL time (this is a UI
 *  default, "today" as the user's wall clock sees it — distinct from
 *  solarPosition.ts's UTC fallback, which only applies to a hand-authored
 *  file that has `location` but no `date`). */
function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function nowHourLocal(): number {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

/** Fractional hour -> "HH:MM" for the <input type="time"> control. */
function hourToTimeString(hour: number): string {
  const clamped = Math.min(24, Math.max(0, hour));
  const totalMinutes = Math.round(clamped * 60);
  const h = Math.min(23, Math.floor(totalMinutes / 60));
  const m = totalMinutes % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/** "HH:MM" -> fractional hour. */
function timeStringToHour(value: string): number {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h)) return 0;
  return h + (Number.isFinite(m) ? m : 0) / 60;
}

/** A sensible starting point when the user first switches to location mode
 *  and no `room.location` exists yet (proposal §4.3: "UI-guarded state, not
 *  a schema error"). Defaults the clock to right now and the date to today
 *  (decision: hour + date, date defaults to today) rather than leaving
 *  lat/long unset — the fields are still all editable immediately after. */
function defaultLocation(): Location {
  return {
    latitudeDeg: 0,
    longitudeDeg: 0,
    orientationDeg: 0,
    timeOfDayHour: nowHourLocal(),
    date: todayIsoLocal(),
  };
}

export function LightingPanel({
  lighting,
  onChange,
  lightingMode,
  onChangeMode,
  location,
  onChangeLocation,
}: {
  lighting: Lighting | undefined;
  onChange: (lighting: Lighting) => void;
  lightingMode: LightingMode | undefined;
  onChangeMode: (mode: LightingMode) => void;
  location: Location | undefined;
  onChangeLocation: (location: Location) => void;
}) {
  const resolved = lighting ?? DEFAULT_LIGHTING;
  const mode = lightingMode ?? "manual";

  // Local mirror for instant slider feedback while dragging — onChange
  // itself is debounced (drives Viewport's lighting effect + autosave),
  // same "instant visual, throttled commit" split as ShellPanel's SurfaceRow.
  const [live, setLive] = useState(resolved);
  useEffect(() => setLive(resolved), [resolved]);
  const debouncedOnChange = useDebouncedCallback(onChange, SLIDER_DEBOUNCE_MS);

  function handleChange(next: Lighting) {
    setLive(next);
    debouncedOnChange(next);
  }

  // Same split for the location fields (proposal §3.4): typing/dragging
  // updates `liveLocation` (and the live hint + viewport) instantly, the
  // scene-file commit + autosave is debounced.
  const [liveLocation, setLiveLocation] = useState(location ?? defaultLocation());
  useEffect(() => {
    if (location) setLiveLocation(location);
  }, [location]);
  const debouncedOnChangeLocation = useDebouncedCallback(onChangeLocation, SLIDER_DEBOUNCE_MS);

  function handleLocationChange(next: Location) {
    setLiveLocation(next);
    debouncedOnChangeLocation(next);
  }

  function handleModeChange(next: LightingMode) {
    // Switching into location mode for the first time with no stored
    // `room.location` yet: commit the default right away so the schema
    // never has `lightingMode: "location"` with `location` undefined for
    // long — resolveSunLighting (buildScene.ts) falls back to manual angles
    // in that gap, so nothing breaks either way, but there's nothing useful
    // to compute from until a location exists.
    if (next === "location" && !location) {
      setLiveLocation(defaultLocation());
      onChangeLocation(defaultLocation());
    }
    onChangeMode(next);
  }

  const computedSun = sceneSunAnglesFromLocation(liveLocation);

  return (
    <div className="lighting-panel">
      <h2 className="lighting-panel-title">Lighting</h2>
      <p className="lighting-panel-hint">
        Adjust the sun (direct light) and ambient (hemisphere) levels. Distance and lamp/fixture
        lighting aren't part of this yet.
      </p>

      <fieldset className="lighting-mode-toggle">
        <legend className="lighting-row-title">Sun source</legend>
        <label className="lighting-mode-option">
          <input type="radio" name="lighting-mode" checked={mode === "manual"} onChange={() => handleModeChange("manual")} />
          <span>Manual</span>
        </label>
        <label className="lighting-mode-option">
          <input
            type="radio"
            name="lighting-mode"
            checked={mode === "location"}
            onChange={() => handleModeChange("location")}
          />
          <span>By location</span>
        </label>
      </fieldset>

      <section className="lighting-row">
        <header className="lighting-row-header">
          <span className="lighting-row-title">Sun</span>
        </header>

        {/* Intensity stays manual-slider-controlled in BOTH modes
         *  (improvements-minor-fixes §9, decision on proposal §6 Q3): location
         *  mode only replaces where azimuth/elevation come from. The render
         *  path additionally scales this down toward zero as the computed
         *  elevation drops through 0 (night fade — buildScene.ts's
         *  resolveSunLighting), on top of whatever this slider is set to. */}
        <label className="lighting-row-field">
          <span>Intensity ({live.sunIntensity.toFixed(2)})</span>
          <input
            type="range"
            min={0}
            max={6}
            step={0.05}
            value={live.sunIntensity}
            onChange={(e) => handleChange({ ...live, sunIntensity: Number(e.target.value) })}
          />
        </label>

        {mode === "manual" && (
          <>
            <label className="lighting-row-field">
              <span>Azimuth ({live.sunAzimuthDeg.toFixed(0)}°)</span>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={live.sunAzimuthDeg}
                onChange={(e) => handleChange({ ...live, sunAzimuthDeg: Number(e.target.value) })}
              />
            </label>

            <label className="lighting-row-field">
              {/* 5-85deg avoids the degenerate near-horizon/near-zenith angles
               *  where the shadow camera frustum (buildScene.ts's fixed +/-700cm
               *  ortho box) stops usefully covering the room. */}
              <span>Elevation ({live.sunElevationDeg.toFixed(0)}°)</span>
              <input
                type="range"
                min={5}
                max={85}
                step={1}
                value={live.sunElevationDeg}
                onChange={(e) => handleChange({ ...live, sunElevationDeg: Number(e.target.value) })}
              />
            </label>
          </>
        )}
      </section>

      {mode === "location" && (
        <section className="lighting-row">
          <header className="lighting-row-header">
            <span className="lighting-row-title">Location</span>
          </header>
          <p className="lighting-panel-hint">
            Raw latitude/longitude, decimal degrees, N/E positive. No geocoding — look the numbers
            up in a map app.
          </p>

          <div className="lighting-location-row">
            <label className="lighting-location-field">
              <span>Latitude (°N)</span>
              <input
                type="number"
                min={-90}
                max={90}
                step={0.0001}
                value={liveLocation.latitudeDeg}
                onChange={(e) => handleLocationChange({ ...liveLocation, latitudeDeg: Number(e.target.value) })}
              />
            </label>
            <label className="lighting-location-field">
              <span>Longitude (°E)</span>
              <input
                type="number"
                min={-180}
                max={180}
                step={0.0001}
                value={liveLocation.longitudeDeg}
                onChange={(e) => handleLocationChange({ ...liveLocation, longitudeDeg: Number(e.target.value) })}
              />
            </label>
          </div>

          <div className="lighting-location-row">
            <label className="lighting-location-field">
              <span>Room faces (°)</span>
              <input
                type="number"
                min={0}
                max={359}
                step={1}
                value={liveLocation.orientationDeg}
                onChange={(e) =>
                  handleLocationChange({ ...liveLocation, orientationDeg: Number(e.target.value) })
                }
              />
            </label>
            <label className="lighting-location-field">
              <span>Quick-set</span>
              <select
                value={nearestCompassDeg(liveLocation.orientationDeg)}
                onChange={(e) => handleLocationChange({ ...liveLocation, orientationDeg: Number(e.target.value) })}
              >
                {COMPASS_POINTS.map((point) => (
                  <option key={point.label} value={point.deg}>
                    {point.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="lighting-location-hint">
            Compass direction the room's back (+Z) wall faces — 0° = north, 90° = east.
          </p>

          <div className="lighting-location-row">
            <label className="lighting-location-field">
              <span>Time</span>
              <input
                type="time"
                value={hourToTimeString(liveLocation.timeOfDayHour)}
                onChange={(e) =>
                  handleLocationChange({ ...liveLocation, timeOfDayHour: timeStringToHour(e.target.value) })
                }
              />
            </label>
            <label className="lighting-location-field">
              <span>Date</span>
              <input
                type="date"
                value={liveLocation.date ?? todayIsoLocal()}
                onChange={(e) => handleLocationChange({ ...liveLocation, date: e.target.value })}
              />
            </label>
          </div>

          <p className="lighting-location-hint">
            computed sun {computedSun.solarAzimuthDeg.toFixed(0)}° / {computedSun.solarElevationDeg.toFixed(0)}°
            above horizon
            {computedSun.solarElevationDeg < 0 ? " (below the horizon — night)" : ""}
          </p>
        </section>
      )}

      <section className="lighting-row">
        <header className="lighting-row-header">
          <span className="lighting-row-title">Ambient</span>
        </header>

        <label className="lighting-row-field">
          <span>Hemisphere intensity ({live.hemisphereIntensity.toFixed(2)})</span>
          <input
            type="range"
            min={0}
            max={3}
            step={0.05}
            value={live.hemisphereIntensity}
            onChange={(e) => handleChange({ ...live, hemisphereIntensity: Number(e.target.value) })}
          />
        </label>
      </section>
    </div>
  );
}
