import { useEffect, useRef, useState } from "react";
import { clearFalKey, loadFalKey, saveFalKey } from "../storage/settings";
import { exportProjectZip } from "../storage/zipExport";
import type { SceneFile } from "../schema/scene";
import "./SettingsPanel.css";

/** Settings panel (Phase 4, PRD §8): fal.ai key paste, stored in IndexedDB,
 *  never bundled or sent anywhere but fal.ai (see ADR-0001 — browser-direct
 *  calls, key visible in this browser's own network requests, acceptable for
 *  a solo/local PoC). Exposes hasKey so ImportPanel can gate the import flow
 *  on a key being present.
 *
 *  Project export (v2 spike, D5 prep): exportProjectZip (Phase 2) had no UI
 *  entry point until now — this wires the existing, already-tested function
 *  to a button so the project (scene JSON + referenced OPFS assets) can
 *  actually leave the browser. */
export function SettingsPanel({
  sceneFile,
  onKeyChange,
}: {
  sceneFile: SceneFile | null;
  onKeyChange?: (hasKey: boolean) => void;
}) {
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "saved">("idle");
  const loaded = useRef(false);

  useEffect(() => {
    loadFalKey().then((key) => {
      setSavedKey(key);
      loaded.current = true;
      onKeyChange?.(key !== null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount; onKeyChange is a stable App.tsx callback
  }, []);

  async function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    await saveFalKey(trimmed);
    setSavedKey(trimmed);
    setDraft("");
    setStatus("saved");
    onKeyChange?.(true);
    setTimeout(() => setStatus("idle"), 1500);
  }

  async function handleClear() {
    await clearFalKey();
    setSavedKey(null);
    onKeyChange?.(false);
  }

  async function handleExport() {
    if (!sceneFile) return;
    const zip = await exportProjectZip(sceneFile);
    const url = URL.createObjectURL(zip);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mirror-project.zip";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="settings-panel">
      <h2 className="settings-panel-title">Settings</h2>
      <section className="settings-row">
        <header className="settings-row-header">
          <span className="settings-row-title">fal.ai API key</span>
          <span className={`settings-row-status settings-row-status--${savedKey ? "set" : "unset"}`}>
            {savedKey ? "saved" : "not set"}
          </span>
        </header>
        <p className="settings-row-hint">
          Used only to call fal.ai's Meshy image-to-3D model directly from this browser — stored
          locally in IndexedDB, never bundled into the app, never sent anywhere else. Get a key at{" "}
          <span className="settings-row-hint-url">fal.ai/dashboard/keys</span>.
        </p>
        <input
          type="password"
          className="settings-row-input"
          placeholder={savedKey ? "Replace saved key…" : "Paste your fal.ai key…"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="settings-row-actions">
          <button type="button" className="settings-row-save-button" onClick={() => void handleSave()} disabled={!draft.trim()}>
            {status === "saved" ? "Saved" : "Save key"}
          </button>
          {savedKey && (
            <button type="button" className="settings-row-clear-button" onClick={() => void handleClear()}>
              Clear
            </button>
          )}
        </div>
      </section>
      <section className="settings-row">
        <header className="settings-row-header">
          <span className="settings-row-title">Export project</span>
        </header>
        <p className="settings-row-hint">
          Bundles the project JSON and every referenced asset (photos, GLBs, textures) into a
          single .zip for portability — e.g. sharing the project outside this browser.
        </p>
        <div className="settings-row-actions">
          <button
            type="button"
            className="settings-row-save-button"
            onClick={() => void handleExport()}
            disabled={!sceneFile}
          >
            Export .zip
          </button>
        </div>
      </section>
    </div>
  );
}
