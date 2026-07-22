import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_SURFACE_CALIBRATION,
  type ShellCalibration,
  type SurfaceCalibration,
} from "../schema/scene";
import { photoToTileableBlob } from "../texturing/pipeline";
import { putAsset } from "../storage/assets";
import { useDebouncedCallback } from "../util/useDebouncedCallback";
import "./ShellPanel.css";

// Range inputs fire `onChange` on every pixel of drag — without debouncing,
// that meant one Viewport calibration-effect run (potentially a full
// texture reload+reapply) per mouse-move event (code review finding).
// 120ms lands comfortably under "feels instant" for a drag gesture while
// collapsing a whole drag into a handful of commits.
const SLIDER_DEBOUNCE_MS = 120;

const SURFACES: Array<{ key: "wall" | "floor" | "ceiling"; label: string }> = [
  { key: "wall", label: "Wall" },
  { key: "floor", label: "Floor" },
  { key: "ceiling", label: "Ceiling" },
];

interface SurfaceRowProps {
  label: string;
  calib: SurfaceCalibration;
  onChange: (calib: SurfaceCalibration) => void;
}

function SurfaceRow({ label, calib, onChange }: SurfaceRowProps) {
  const [status, setStatus] = useState<"idle" | "processing" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  // Local mirror of `calib` for instant slider/label feedback while
  // dragging — `onChange` itself is debounced (see below) because it drives
  // Viewport's calibration effect (storage write + possible texture
  // reload), which must not run once per pixel of drag (code review
  // finding). Synced from the prop on every change so an external update
  // (e.g. a fresh upload elsewhere, or the initial load) still shows.
  const [liveCalib, setLiveCalib] = useState(calib);
  useEffect(() => setLiveCalib(calib), [calib]);
  const debouncedOnChange = useDebouncedCallback(onChange, SLIDER_DEBOUNCE_MS);

  function handleSliderChange(next: SurfaceCalibration) {
    setLiveCalib(next); // immediate visual feedback
    debouncedOnChange(next); // throttled commit
  }

  async function handleFile(file: File) {
    setStatus("processing");
    try {
      const tileable = await photoToTileableBlob(file);
      const hash = await putAsset(tileable);
      const next = { ...calib, assetHash: hash };
      setLiveCalib(next);
      onChange(next); // a photo upload is a one-shot event, not a drag — commit immediately
      setStatus("idle");
    } catch (err) {
      console.error("[ShellPanel] tileable-texture pipeline failed", err);
      setStatus("error");
    }
  }

  return (
    <section className="shell-row">
      <header className="shell-row-header">
        <span className="shell-row-title">{label}</span>
        <span className={`shell-row-status shell-row-status--${calib.assetHash ? "photo" : "none"}`}>
          {calib.assetHash ? "photo applied" : "procedural"}
        </span>
      </header>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="shell-row-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="shell-row-upload-button"
        onClick={() => inputRef.current?.click()}
        disabled={status === "processing"}
      >
        {status === "processing" ? "Processing…" : calib.assetHash ? "Replace photo" : "Upload photo"}
      </button>
      {status === "error" && <p className="shell-row-error">Couldn't process that photo — try another.</p>}

      <label className="shell-row-field">
        <span>Tint</span>
        <input
          type="color"
          value={liveCalib.tint}
          onChange={(e) => handleSliderChange({ ...liveCalib, tint: e.target.value })}
        />
      </label>

      <label className="shell-row-field">
        <span>Repeat X ({liveCalib.repeat[0].toFixed(2)}×)</span>
        <input
          type="range"
          min={0.25}
          max={4}
          step={0.05}
          value={liveCalib.repeat[0]}
          onChange={(e) =>
            handleSliderChange({ ...liveCalib, repeat: [Number(e.target.value), liveCalib.repeat[1]] })
          }
        />
      </label>

      <label className="shell-row-field">
        <span>Repeat Y ({liveCalib.repeat[1].toFixed(2)}×)</span>
        <input
          type="range"
          min={0.25}
          max={4}
          step={0.05}
          value={liveCalib.repeat[1]}
          onChange={(e) =>
            handleSliderChange({ ...liveCalib, repeat: [liveCalib.repeat[0], Number(e.target.value)] })
          }
        />
      </label>

      <label className="shell-row-field">
        <span>Roughness ({liveCalib.roughnessScale.toFixed(2)}×)</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={liveCalib.roughnessScale}
          onChange={(e) => handleSliderChange({ ...liveCalib, roughnessScale: Number(e.target.value) })}
        />
      </label>
    </section>
  );
}

export function ShellPanel({
  shell,
  onUpdateSurface,
}: {
  shell: ShellCalibration | undefined;
  onUpdateSurface: (surface: "wall" | "floor" | "ceiling", calib: SurfaceCalibration) => void;
}) {
  return (
    <div className="shell-panel">
      <h2 className="shell-panel-title">Shell texturing</h2>
      <p className="shell-panel-hint">
        Upload a straight-on, evenly-lit photo of each surface. It's turned into a tileable
        texture automatically — use the sliders below to calibrate against your real room.
      </p>
      {SURFACES.map(({ key, label }) => (
        <SurfaceRow
          key={key}
          label={label}
          calib={shell?.[key] ?? DEFAULT_SURFACE_CALIBRATION}
          onChange={(calib) => onUpdateSurface(key, calib)}
        />
      ))}
    </div>
  );
}
