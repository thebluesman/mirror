// Phase 5 shell-texture lever 1 (PRD-v2 §7.5 / §11.2: "better CC0 source
// textures, calibrated to Shyam's surface photos via the existing
// tint/repeat calibration UI"). This module is the one place that names
// which source image feeds each surface and what starting calibration to
// apply — everything downstream (tileable.ts, pipeline.ts, shellMaterials.ts,
// ShellPanel.tsx) stays completely source-agnostic; they only ever see a
// Blob/File and a SurfaceCalibration, never a filename or provider.
//
// *** SUBSTITUTE SOURCES — READ BEFORE SWAPPING ***
// PRD-v2 §7.5 names Poly Haven / ambientCG as the CC0 source for this lever.
// Both are unreachable from this build sandbox (proxy policy denial —
// api.polyhaven.com / ambientcg.com both 403, consistent with
// spike/research/texture-sources.md). The two files referenced below are
// GitHub-raw-sourced substitutes (BabylonJS/Assets, CC BY 4.0) picked only
// because the named sources were blocked here — see
// src/assets/shell-source-textures/README.md for the full search record and
// licensing detail. Swapping to a genuine Poly Haven/ambientCG file later is
// a one-line change per surface below (`sourceFile` + a re-tuned
// `calibration`) — nothing else needs to change.
//
// Not currently wired into the app's own fresh-seed path (App.tsx's
// loadInitialScene) — that would mean this file's calibration silently
// overwrites whatever a real user already uploaded, which is out of scope
// for a one-iteration lever-1 pass. It's consumed today by
// v2-review/shell-quality's before/after comparison driver, which applies it
// through the exact same ShellPanel.tsx upload + slider path Shyam already
// uses, so wiring it into a real default later (if Shyam wants that) is a
// small, separate follow-up, not a pipeline change.
import defaultShellTexturesData from "./defaultShellTextures.json";
import type { SurfaceCalibration } from "../schema/scene";

export interface DefaultShellSurfaceConfig {
  /** Repo-relative path to the committed source image (see the README next
   *  to it for provenance/license). */
  sourceFile: string;
  /** Human-readable "who made this, what license" note. */
  attribution: string;
  /** Starting tint/repeat/roughnessScale — computed from average-color
   *  matching against spike/inputs/surfaces/*.JPG (see the JSON's
   *  `sampledColors`), not a final hand-tuned result. */
  calibration: SurfaceCalibration;
}

interface DefaultShellTexturesData {
  note: string;
  sampledColors: unknown;
  surfaces: {
    floor: DefaultShellSurfaceConfig;
    wall: DefaultShellSurfaceConfig;
    ceiling: DefaultShellSurfaceConfig;
  };
}

export const DEFAULT_SHELL_TEXTURES: DefaultShellTexturesData =
  defaultShellTexturesData as DefaultShellTexturesData;
