/**
 * shell-textures.mjs — W-B (poc3-plan.md §4): apply photo-derived (or CC0)
 * shell textures to scene2.html's room, with a calibration pass and a silent
 * procedural fallback when a surface's files aren't on disk yet.
 *
 * MESH TARGETING — scene2.html assigns NO mesh.name/userData tags at all, and
 * this module must not edit scene2.html (file-ownership rule, W-B spike). So
 * meshes are found structurally, by re-deriving the same signals scene2.html
 * itself used to build them:
 *
 *   - WALLS   : mesh.material === opts.MAT.wall (reference equality). Every
 *               solid wall segment in addWall()/addSegment() is built with
 *               the literal shared MAT.wall material object (default param
 *               `mat = MAT.wall`, never cloned) — so this one comparison
 *               catches every wall segment, sill, and lintel in one pass.
 *               CONSEQUENCE: because it's one shared material, all walls get
 *               ONE global texture repeat (see "wall repeat" below) — walls
 *               are documented in poc3-plan.md as needing only "a sensible
 *               meters-scale repeat", not per-wall cm-truth, so this is an
 *               accepted approximation, not a bug.
 *   - FLOOR   : mesh.geometry.type === "PlaneGeometry" AND mesh.position.y
 *               within 1cm of 0. addFloor() builds one PlaneGeometry per
 *               DATA.floor rect, each with ITS OWN std({map,...}) material
 *               instance (not shared) — so each floor mesh can get its own
 *               cm-true 60cm-tile repeat computed from ITS OWN geometry
 *               parameters (geometry.parameters.width/height are the pre-
 *               rotation plane extents, i.e. the rect's [w, d] in cm).
 *   - CEILING : mesh.geometry.type === "PlaneGeometry" AND mesh.position.y
 *               within 1cm of opts.ceilingHeight (default 240 — matches
 *               DATA.ceilingHeight in scene2.html). addCeiling() clones
 *               MAT.ceiling per rect, so ceiling meshes also get independent
 *               materials.
 *
 * INTEGRATION (the one line the orchestrator adds to scene2.html, after the
 * MAT object and DATA.floor.forEach(...)/addWall(...) calls that build the
 * meshes above — texture application must run AFTER those meshes exist):
 *
 *   import { applyShellTextures } from "./textures/shell-textures.mjs";
 *   applyShellTextures(scene, THREE, { MAT, renderer }).then(r => console.info("[shell]", r));
 *
 * PROBING — per surface, this module does a fetch HEAD (falling back to a
 * ranged GET for servers that reject HEAD) against textures/<surface>/
 * albedo.jpg before ever calling TextureLoader. A missing/failed probe is
 * NOT an error: the surface is left exactly as scene2.html built it
 * (procedural canvas texture or flat color) and reported as
 * "procedural-fallback". Only an info-level console log is emitted either
 * way — never console.error/warn from this module.
 *
 * CALIBRATION — textures/calibration.json (see the shipped default file) is
 * applied multiplicatively on top of whatever was loaded:
 *   tint            multiplies material.color (hex, '#ffffff' = no-op)
 *   repeat          [x,y] multiplies the computed real-world repeat
 *   roughnessScale  multiplies material.roughness (clamped to [0,1])
 * A missing/unparseable calibration.json is treated the same as an
 * all-defaults file (silent, no adjustment).
 */

const DEFAULT_BASE = "textures/";
const MAP_NAMES = { albedo: "albedo.jpg", normal: "normal.jpg", roughness: "roughness.jpg" };

async function probeExists(url) {
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (head.ok) return true;
    // Some static servers / configs don't implement HEAD cleanly — confirm
    // with a 1-byte ranged GET before giving up.
    const ranged = await fetch(url, { headers: { Range: "bytes=0-0" } });
    return ranged.ok || ranged.status === 206;
  } catch {
    return false;
  }
}

async function loadCalibration(basePath, log) {
  try {
    const res = await fetch(`${basePath}calibration.json`);
    if (!res.ok) {
      log(`calibration.json not found at ${basePath}calibration.json — using no-op defaults.`);
      return {};
    }
    return JSON.parse(await res.text());
  } catch (err) {
    log(`calibration.json failed to load/parse (${err.message}) — using no-op defaults.`);
    return {};
  }
}

async function loadMapSet(THREE, basePath, surface, log) {
  const dir = `${basePath}${surface}/`;
  const albedoUrl = dir + MAP_NAMES.albedo;
  if (!(await probeExists(albedoUrl))) return null;

  const loader = new THREE.TextureLoader();
  const [normalExists, roughnessExists] = await Promise.all([
    probeExists(dir + MAP_NAMES.normal),
    probeExists(dir + MAP_NAMES.roughness),
  ]);

  const albedo = await loader.loadAsync(albedoUrl);
  albedo.colorSpace = THREE.SRGBColorSpace; // albedo is color data
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;

  let normalMap = null, roughnessMap = null;
  if (normalExists) {
    normalMap = await loader.loadAsync(dir + MAP_NAMES.normal);
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping; // non-color data — leave colorSpace default (linear)
  }
  if (roughnessExists) {
    roughnessMap = await loader.loadAsync(dir + MAP_NAMES.roughness);
    roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  }

  log(`${surface}: loaded albedo${normalMap ? "+normal" : ""}${roughnessMap ? "+roughness" : ""} from ${dir}`);
  return { albedo, normalMap, roughnessMap };
}

function collectShellMeshes(scene, MAT, ceilingHeight) {
  const floorMeshes = [], ceilingMeshes = [], wallMeshes = [];
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    if (MAT && MAT.wall && obj.material === MAT.wall) { wallMeshes.push(obj); return; }
    const geo = obj.geometry;
    if (geo && geo.type === "PlaneGeometry") {
      const y = obj.position.y;
      if (Math.abs(y) < 1) floorMeshes.push(obj);
      else if (Math.abs(y - ceilingHeight) < 1) ceilingMeshes.push(obj);
    }
  });
  return { floorMeshes, ceilingMeshes, wallMeshes };
}

function estimateWallRepeat(wallMeshes) {
  if (!wallMeshes.length) return [2, 2.4]; // sane default: ~2m tiling, ~2.4m (room height) tall
  let sumLen = 0, sumH = 0, n = 0;
  wallMeshes.forEach((m) => {
    const p = m.geometry && m.geometry.parameters;
    if (!p) return;
    const longDim = Math.max(p.width || 0, p.depth || 0); // the wall-plane span, not the 10cm thickness
    sumLen += longDim; sumH += p.height || 0; n++;
  });
  if (!n) return [2, 2.4];
  return [Math.max(1, sumLen / n / 100), Math.max(1, sumH / n / 100)]; // cm -> m-scale repeat
}

function applyRepeatCalibration(repeat, calib) {
  if (calib && Array.isArray(calib.repeat) && calib.repeat.length === 2) {
    repeat[0] *= calib.repeat[0];
    repeat[1] *= calib.repeat[1];
  }
  return repeat;
}

function cloneMapSet(THREE, maps) {
  return {
    albedo: maps.albedo.clone(),
    normalMap: maps.normalMap ? maps.normalMap.clone() : null,
    roughnessMap: maps.roughnessMap ? maps.roughnessMap.clone() : null,
  };
}

function applyMapsToMaterial(THREE, mat, maps, calib, repeat, renderer) {
  const { albedo, normalMap, roughnessMap } = maps;
  albedo.repeat.set(repeat[0], repeat[1]);
  if (renderer) {
    try { albedo.anisotropy = renderer.capabilities.getMaxAnisotropy(); } catch { /* headless/no-op */ }
  }
  mat.map = albedo;

  if (normalMap) {
    normalMap.repeat.copy(albedo.repeat);
    mat.normalMap = normalMap;
    if (!mat.normalScale) mat.normalScale = new THREE.Vector2(1, 1);
  }
  if (roughnessMap) {
    roughnessMap.repeat.copy(albedo.repeat);
    mat.roughnessMap = roughnessMap;
  }

  if (calib) {
    if (typeof calib.tint === "string") {
      mat.color.multiply(new THREE.Color(calib.tint)); // multiplicative — '#ffffff' is a no-op
    }
    if (typeof calib.roughnessScale === "number") {
      mat.roughness = Math.max(0, Math.min(1, mat.roughness * calib.roughnessScale));
    }
  }
  mat.needsUpdate = true;
}

/**
 * @param {THREE.Scene} scene
 * @param {*} THREE - the same three.js module instance scene2.html imported (must match, for instanceof/enum checks)
 * @param {object} [opts]
 * @param {object} [opts.MAT] - scene2.html's MAT object; required to find/texture the wall material
 * @param {*} [opts.renderer] - pass renderer for anisotropic floor filtering (optional)
 * @param {number} [opts.ceilingHeight=240] - must match scene2.html's DATA.ceilingHeight
 * @param {string} [opts.basePath="textures/"] - relative path (from the served HTML) to this directory
 * @param {function} [opts.log] - override the info logger (default console.info-based)
 * @returns {Promise<{wall: 'photo'|'procedural-fallback', floor: 'photo'|'procedural-fallback', ceiling: 'photo'|'procedural-fallback'}>}
 */
export async function applyShellTextures(scene, THREE, opts = {}) {
  const {
    MAT = null,
    renderer = null,
    ceilingHeight = 240,
    basePath = DEFAULT_BASE,
    log = (msg) => console.info(`[shell-textures] ${msg}`),
  } = opts;

  const calibration = await loadCalibration(basePath, log);
  const { floorMeshes, ceilingMeshes, wallMeshes } = collectShellMeshes(scene, MAT, ceilingHeight);
  const report = {};

  // --- WALL --------------------------------------------------------------
  if (MAT && MAT.wall) {
    const maps = await loadMapSet(THREE, basePath, "wall", log);
    if (maps) {
      const repeat = applyRepeatCalibration(estimateWallRepeat(wallMeshes), calibration.wall);
      applyMapsToMaterial(THREE, MAT.wall, maps, calibration.wall, repeat, renderer);
      report.wall = "photo";
      log(`wall: photo texture applied to ${wallMeshes.length} mesh(es) sharing MAT.wall; repeat=[${repeat.map(n => n.toFixed(2))}] (single global estimate — see module header)`);
    } else {
      report.wall = "procedural-fallback";
      log(`wall: no textures/wall/albedo.jpg on disk — leaving scene2.html's existing wall material untouched.`);
    }
  } else {
    report.wall = "procedural-fallback";
    log(`wall: opts.MAT.wall not provided — cannot target the wall material, skipping.`);
  }

  // --- FLOOR --------------------------------------------------------------
  if (floorMeshes.length) {
    const maps = await loadMapSet(THREE, basePath, "floor", log);
    if (maps) {
      floorMeshes.forEach((mesh) => {
        const p = mesh.geometry.parameters; // pre-rotation plane extents == rect [w, d] in cm
        const repeat = applyRepeatCalibration([p.width / 60, p.height / 60], calibration.floor); // cm-true 60cm tiles
        applyMapsToMaterial(THREE, mesh.material, cloneMapSet(THREE, maps), calibration.floor, repeat, renderer);
      });
      report.floor = "photo";
      log(`floor: photo texture applied to ${floorMeshes.length} mesh(es), cm-true 60cm repeat per rect.`);
    } else {
      report.floor = "procedural-fallback";
      log(`floor: no textures/floor/albedo.jpg on disk — leaving scene2.html's existing procedural tile material untouched.`);
    }
  } else {
    report.floor = "procedural-fallback";
    log(`floor: no PlaneGeometry mesh found at y≈0 — nothing to texture (unexpected; scene2.html's addFloor() may have changed).`);
  }

  // --- CEILING --------------------------------------------------------------
  if (ceilingMeshes.length) {
    const maps = await loadMapSet(THREE, basePath, "ceiling", log);
    if (maps) {
      ceilingMeshes.forEach((mesh) => {
        const p = mesh.geometry.parameters;
        const repeat = applyRepeatCalibration([p.width / 100, p.height / 100], calibration.ceiling); // meters-scale
        applyMapsToMaterial(THREE, mesh.material, cloneMapSet(THREE, maps), calibration.ceiling, repeat, renderer);
      });
      report.ceiling = "photo";
      log(`ceiling: photo texture applied to ${ceilingMeshes.length} mesh(es).`);
    } else {
      report.ceiling = "procedural-fallback";
      log(`ceiling: no textures/ceiling/albedo.jpg on disk — leaving scene2.html's existing flat ceiling material untouched.`);
    }
  } else {
    report.ceiling = "procedural-fallback";
    log(`ceiling: no PlaneGeometry mesh found at y≈${ceilingHeight} — nothing to texture (unexpected; scene2.html's addCeiling() may have changed).`);
  }

  return report;
}
