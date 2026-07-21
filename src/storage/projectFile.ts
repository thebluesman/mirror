// File System Access API save/load for the project JSON (PRD §8), with a
// plain download/upload fallback for browsers without the picker (feature-
// detected — Firefox/Safari as of this writing). The autosave (IndexedDB)
// handles in-between persistence; this is the explicit "save the project
// file" / "open a project file" action.
//
// Browser-only by construction (window/document APIs); exercised in the app,
// not in the node test suite.

import { parseScene, type SceneFile } from "../schema/scene";

const DEFAULT_NAME = "home.mirror.json";

interface SaveFilePickerWindow {
  showSaveFilePicker: (opts: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
}

interface OpenFilePickerWindow {
  showOpenFilePicker: (opts: {
    multiple?: boolean;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle[]>;
}

const JSON_TYPES = [
  { description: "mirror project", accept: { "application/json": [".json"] } },
];

function hasSavePicker(w: Window): w is Window & SaveFilePickerWindow {
  return "showSaveFilePicker" in w;
}

function hasOpenPicker(w: Window): w is Window & OpenFilePickerWindow {
  return "showOpenFilePicker" in w;
}

/** Save the project to a file the user picks, or download it as a fallback. */
export async function saveProjectToFile(
  scene: SceneFile,
  suggestedName = DEFAULT_NAME,
): Promise<void> {
  const json = JSON.stringify(scene, null, 2);
  if (hasSavePicker(window)) {
    const handle = await window.showSaveFilePicker({ suggestedName, types: JSON_TYPES });
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    return;
  }
  downloadBlob(new Blob([json], { type: "application/json" }), suggestedName);
}

/** Open a project file the user picks (native picker or file input fallback). */
export async function loadProjectFromFile(): Promise<SceneFile> {
  let file: File;
  if (hasOpenPicker(window)) {
    const [handle] = await window.showOpenFilePicker({ multiple: false, types: JSON_TYPES });
    file = await handle.getFile();
  } else {
    file = await pickFileViaInput(".json,application/json");
  }
  return parseScene(JSON.parse(await file.text()));
}

/** Trigger a browser download of a blob. Shared by the JSON fallback and zip export. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function pickFileViaInput(accept: string): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) resolve(file);
      else reject(new Error("No file selected"));
    };
    input.click();
  });
}
