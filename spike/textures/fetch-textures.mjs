#!/usr/bin/env node
/**
 * fetch-textures.mjs — download CC0 texture sets for the room shell
 * (wall paint/plaster, 60x60 floor tile, ceiling) from ambientCG.
 *
 * Context: this repo's sandbox has ambientCG/Poly Haven/unpkg/jsDelivr proxy-
 * blocked (see spike/research/texture-sources.md §1 — verified 403s, not
 * guesses). This script CANNOT be run to completion from that sandbox. It is
 * written to run on Shyam's machine, which has open network access per
 * poc3-plan.md §4 W-B ("Shyam ... runs downloads locally").
 *
 * IMPORTANT — set name disclaimer: ambientCG's catalog could not be browsed
 * from the sandbox (blocked), so the set names below are *plausible,
 * unverified guesses* at well-known CC0 families (Plaster/Tiles), not
 * confirmed to exist. That's why each surface lists a primary + 2 alternates:
 * if a name 404s, the script tries the next one for that surface. Shyam should
 * swap in exact names once he can browse ambientcg.com himself if all three
 * guesses miss.
 *
 * Usage:
 *   node fetch-textures.mjs            # fetch all surfaces, skip existing
 *   node fetch-textures.mjs --force    # re-download even if a surface looks done
 *   node fetch-textures.mjs wall floor # only these surfaces
 *
 * Output layout (matches what shell-textures.mjs probes for):
 *   spike/textures/<surface>/albedo.jpg
 *   spike/textures/<surface>/normal.jpg     (when the set ships one)
 *   spike/textures/<surface>/roughness.jpg  (when the set ships one)
 *   spike/textures/<surface>/SOURCE.txt     (which candidate name + URL won)
 *
 * These directories are gitignored (spike/.gitignore) — downloaded payloads
 * are never committed, only this script + shell-textures.mjs + calibration.json.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Primary candidate first, then up to 2 alternates per surface — so one bad
// guess at a set name doesn't strand a surface with nothing.
const CANDIDATES = {
  wall: ["Plaster001", "Plaster003", "PaintedPlaster001"],
  floor: ["Tiles101", "Tiles074", "Tiles087"],
  ceiling: ["Plaster005", "Plaster001", "Concrete034"],
};

// ambientCG direct-download convention (no API key / auth needed for CC0 zips).
const zipUrl = (name) => `https://ambientcg.com/get?file=${name}_1K-JPG.zip`;

// Inside an ambientCG "<Name>_1K-JPG.zip", files are named
// "<Name>_1K-JPG_<Map>.jpg" for Color / NormalGL / Roughness / etc.
const MAP_SUFFIXES = {
  albedo: ["Color"],
  normal: ["NormalGL", "Normal"],
  roughness: ["Roughness"],
};

function log(...args) { console.log("[fetch-textures]", ...args); }
function warn(...args) { console.warn("[fetch-textures] WARN", ...args); }

async function urlOk(url) {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (res.ok) return true;
    // Some hosts (ambientCG included, historically) reject HEAD; fall back to
    // a ranged GET before declaring the candidate dead.
    const res2 = await fetch(url, { headers: { Range: "bytes=0-0" }, redirect: "follow" });
    return res2.ok || res2.status === 206;
  } catch (err) {
    return false;
  }
}

async function downloadToFile(url, destFile) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`suspiciously small response (${buf.length} bytes) — likely an error page, not a zip`);
  await fsp.writeFile(destFile, buf);
  return buf.length;
}

function unzip(zipFile, destDir) {
  const r = spawnSync("unzip", ["-o", zipFile, "-d", destDir], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`unzip exited ${r.status}: ${r.stderr || r.stdout}`);
  }
}

async function findMapFile(dir, name, suffixList) {
  const entries = await fsp.readdir(dir);
  for (const suffix of suffixList) {
    const hit = entries.find((f) => f.toLowerCase().endsWith(`_${suffix.toLowerCase()}.jpg`) || f.toLowerCase().endsWith(`_${suffix.toLowerCase()}.png`));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

async function surfaceReady(surfaceDir) {
  try {
    const st = await fsp.stat(path.join(surfaceDir, "albedo.jpg"));
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

async function fetchSurface(surface, force) {
  const surfaceDir = path.join(__dirname, surface);
  await fsp.mkdir(surfaceDir, { recursive: true });

  if (!force && (await surfaceReady(surfaceDir))) {
    log(`${surface}: already present (albedo.jpg exists) — skipping. Use --force to re-download.`);
    return { surface, status: "skipped-existing" };
  }

  const candidates = CANDIDATES[surface] || [];
  const attempts = [];

  for (const name of candidates) {
    const url = zipUrl(name);
    log(`${surface}: trying candidate "${name}" (${url})`);
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), `texfetch-${surface}-`));
    const zipPath = path.join(tmpDir, `${name}.zip`);
    try {
      const bytes = await downloadToFile(url, zipPath);
      log(`${surface}: downloaded ${name} (${(bytes / 1024).toFixed(0)} KB), unzipping...`);
      unzip(zipPath, tmpDir);

      const albedo = await findMapFile(tmpDir, name, MAP_SUFFIXES.albedo);
      if (!albedo) throw new Error("zip did not contain a recognizable *_Color.jpg albedo map");
      const normal = await findMapFile(tmpDir, name, MAP_SUFFIXES.normal);
      const roughness = await findMapFile(tmpDir, name, MAP_SUFFIXES.roughness);

      await fsp.copyFile(albedo, path.join(surfaceDir, "albedo.jpg"));
      if (normal) await fsp.copyFile(normal, path.join(surfaceDir, "normal.jpg"));
      if (roughness) await fsp.copyFile(roughness, path.join(surfaceDir, "roughness.jpg"));

      await fsp.writeFile(
        path.join(surfaceDir, "SOURCE.txt"),
        `surface: ${surface}\ncandidate: ${name}\nurl: ${url}\nfetched: ${new Date().toISOString()}\nmaps: albedo${normal ? "+normal" : ""}${roughness ? "+roughness" : ""}\nlicense: CC0 (ambientCG) — verify set name is real; catalog was unreachable from the authoring sandbox.\n`
      );

      log(`${surface}: SUCCESS via "${name}" — albedo${normal ? ", normal" : ""}${roughness ? ", roughness" : ""} written to ${surfaceDir}`);
      attempts.push({ name, url, ok: true });
      await fsp.rm(tmpDir, { recursive: true, force: true });
      return { surface, status: "ok", winner: name, attempts };
    } catch (err) {
      warn(`${surface}: candidate "${name}" failed — ${err.message}`);
      attempts.push({ name, url, ok: false, error: err.message });
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      // try next candidate
    }
  }

  warn(`${surface}: ALL candidates failed. shell-textures.mjs will fall back to the procedural material for this surface.`);
  return { surface, status: "failed", attempts };
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const requested = args.filter((a) => !a.startsWith("--"));
  const surfaces = requested.length ? requested : Object.keys(CANDIDATES);

  log(`Fetching surfaces: ${surfaces.join(", ")}${force ? " (--force)" : ""}`);
  log(`NOTE: ambientCG is proxy-blocked from the sandbox this script was authored in.`);
  log(`It has NOT been run to completion there — run it on a machine with open network access.`);

  const results = [];
  for (const surface of surfaces) {
    if (!CANDIDATES[surface]) {
      warn(`unknown surface "${surface}", skipping. Known: ${Object.keys(CANDIDATES).join(", ")}`);
      continue;
    }
    results.push(await fetchSurface(surface, force));
  }

  console.log("\n=== fetch-textures summary ===");
  for (const r of results) {
    console.log(`  ${r.surface.padEnd(8)} ${r.status === "ok" ? `READY (${r.winner})` : r.status === "skipped-existing" ? "READY (existing)" : "MISSING — procedural fallback will be used"}`);
  }
  const anyFailed = results.some((r) => r.status === "failed");
  if (anyFailed) {
    console.log("\nSome surfaces are missing real textures. This is non-fatal: shell-textures.mjs");
    console.log("silently falls back to scene2.html's existing procedural material for any surface");
    console.log("whose directory has no albedo.jpg. Re-run with corrected candidate names in");
    console.log("CANDIDATES, or use make-tileable.mjs against Shyam's own photos instead.");
  }
  process.exitCode = anyFailed ? 1 : 0;
}

main().catch((err) => {
  console.error("[fetch-textures] FATAL", err);
  process.exitCode = 1;
});
