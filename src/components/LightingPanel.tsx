import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_LIGHTING, type Lighting } from "../schema/scene";
import "./LightingPanel.css";

// Same debounce shape as ShellPanel's — range inputs fire onChange on every
// pixel of drag, and each commit here writes through App.tsx's
// updateLighting (setSceneFile + saveProjectDebounced), so an undebounced
// drag would autosave once per mouse-move. Not shared as an import from
// ShellPanel.tsx (small enough, and the two panels aren't meant to couple).
const SLIDER_DEBOUNCE_MS = 120;

/** Debounces a callback by `delayMs`, always calling with the most recent
 *  args. Flushes any pending call on unmount so a drag-then-navigate-away
 *  doesn't drop the final value. */
function useDebouncedCallback<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): (...args: Args) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingArgsRef = useRef<Args | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        if (pendingArgsRef.current) fnRef.current(...pendingArgsRef.current);
      }
    },
    [],
  );

  return useMemo(() => {
    const debounced = (...args: Args) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingArgsRef.current = args;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pendingArgsRef.current = null;
        fnRef.current(...args);
      }, delayMs);
    };
    return debounced;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fn is read via fnRef so it can change every render without re-debouncing
  }, [delayMs]);
}

export function LightingPanel({
  lighting,
  onChange,
}: {
  lighting: Lighting | undefined;
  onChange: (lighting: Lighting) => void;
}) {
  const resolved = lighting ?? DEFAULT_LIGHTING;

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

  return (
    <div className="lighting-panel">
      <h2 className="lighting-panel-title">Lighting</h2>
      <p className="lighting-panel-hint">
        Adjust the sun (direct light) and ambient (hemisphere) levels. Distance and lamp/fixture
        lighting aren't part of this yet.
      </p>

      <section className="lighting-row">
        <header className="lighting-row-header">
          <span className="lighting-row-title">Sun</span>
        </header>

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
      </section>

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
