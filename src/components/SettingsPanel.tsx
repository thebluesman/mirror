import { useEffect, useRef, useState } from "react";
import { clearFalKey, loadFalKey, saveFalKey } from "../storage/settings";
import { exportProjectZip, importProjectZip } from "../storage/zipExport";
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
 *  actually leave the browser.
 *
 *  Project import (improvements-v2.1 §6): the inverse — importProjectZip
 *  (storage/zipExport.ts) already unzips, validates via parseScene, and
 *  rehydrates every referenced asset into OPFS; this is UI wiring only.
 *  onImportProject hands the parsed SceneFile up to App.tsx's `commit`, the
 *  same persist+undo-record tail every other discrete scene-replacing action
 *  goes through (see handleImported) — an imported project is one-step
 *  undoable for free, so no separate confirm dialog on top of that. */
export function SettingsPanel({
  sceneFile,
  onKeyChange,
  onImportProject,
}: {
  sceneFile: SceneFile | null;
  onKeyChange?: (hasKey: boolean) => void;
  onImportProject: (next: SceneFile) => void;
}) {
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "saved">("idle");
  const loaded = useRef(false);

  // Mirrors ImportPanel's FlatTextureRow status shape (idle/processing/error)
  // — the closest existing "simple async action with an error state" in this
  // panel family — plus the caught error's own message, since a bad zip can
  // fail for a couple of distinct reasons (no project.json, schema mismatch)
  // worth surfacing verbatim rather than behind one generic string.
  const [importStatus, setImportStatus] = useState<"idle" | "importing" | "error">("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

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

  async function handleImportFile(file: File) {
    setImportStatus("importing");
    setImportError(null);
    try {
      const next = await importProjectZip(file);
      onImportProject(next);
      setImportStatus("idle");
    } catch (err) {
      // Bad zip (no project.json) or a schema validation error — both come
      // straight out of importProjectZip with a useful .message; surface it
      // as-is rather than genericizing it away.
      console.error("[SettingsPanel] project import failed", err);
      setImportStatus("error");
      setImportError(err instanceof Error ? err.message : String(err));
    }
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
          Used only to call fal.ai's Hunyuan3D image-to-3D model directly from this browser — stored
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
      <section className="settings-row">
        <header className="settings-row-header">
          <span className="settings-row-title">Import project</span>
        </header>
        <p className="settings-row-hint">
          Loads a project .zip (from this app's own export, or a previously exported one) as the
          active project.
        </p>
        <p className="settings-row-warning">
          Replaces the entire current project — undo (Cmd/Ctrl+Z) reverts it once.
        </p>
        <input
          ref={importInputRef}
          type="file"
          accept=".zip,application/zip"
          className="settings-row-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = "";
          }}
        />
        <div className="settings-row-actions">
          <button
            type="button"
            className="settings-row-save-button"
            onClick={() => importInputRef.current?.click()}
            disabled={importStatus === "importing"}
          >
            {importStatus === "importing" ? "Importing…" : "Import .zip"}
          </button>
        </div>
        {importStatus === "error" && (
          <p className="settings-row-error">Couldn't import that project: {importError}</p>
        )}
      </section>
    </div>
  );
}
