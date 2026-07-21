import { useRef, useState } from "react";
import {
  DEFAULT_SURFACE_CALIBRATION,
  type ShellCalibration,
  type SurfaceCalibration,
} from "../schema/scene";
import { photoToTileableBlob } from "../texturing/pipeline";
import { putAsset } from "../storage/assets";
import "./ShellPanel.css";

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

  async function handleFile(file: File) {
    setStatus("processing");
    try {
      const tileable = await photoToTileableBlob(file);
      const hash = await putAsset(tileable);
      onChange({ ...calib, assetHash: hash });
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
          value={calib.tint}
          onChange={(e) => onChange({ ...calib, tint: e.target.value })}
        />
      </label>

      <label className="shell-row-field">
        <span>Repeat X ({calib.repeat[0].toFixed(2)}×)</span>
        <input
          type="range"
          min={0.25}
          max={4}
          step={0.05}
          value={calib.repeat[0]}
          onChange={(e) => onChange({ ...calib, repeat: [Number(e.target.value), calib.repeat[1]] })}
        />
      </label>

      <label className="shell-row-field">
        <span>Repeat Y ({calib.repeat[1].toFixed(2)}×)</span>
        <input
          type="range"
          min={0.25}
          max={4}
          step={0.05}
          value={calib.repeat[1]}
          onChange={(e) => onChange({ ...calib, repeat: [calib.repeat[0], Number(e.target.value)] })}
        />
      </label>

      <label className="shell-row-field">
        <span>Roughness ({calib.roughnessScale.toFixed(2)}×)</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={calib.roughnessScale}
          onChange={(e) => onChange({ ...calib, roughnessScale: Number(e.target.value) })}
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
