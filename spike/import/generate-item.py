# /// script
# requires-python = ">=3.9"
# dependencies = ["fal-client", "httpx"]
# ///
"""
generate-item.py - fal.ai image-to-3D submission script for PoC 3 / W-A (D1).

Sends one item image to `fal-ai/meshy/v6/image-to-3d` (Meshy 6, per
poc3-plan.md sec.4 W-A) and downloads the resulting GLB to
spike/import/glb/<item>.glb.

Reuses the fal_client.subscribe(...) + upload_file(...) pattern from
spike/generate.py (same repo, same throwaway-spike style).

Run with:
    uv run generate-item.py --image path/or/url --item swivel-chair
or:
    python3 generate-item.py --image ... --item ...   (after `pip install fal-client httpx`)

Requires the FAL_KEY environment variable (https://fal.ai/dashboard/keys).
FAL_KEY is read from the environment ONLY -- never hardcode it here, never commit it.

--------------------------------------------------------------------------
UNTESTED AGAINST THE LIVE API -- READ BEFORE RUNNING FOR REAL
--------------------------------------------------------------------------
This script was written without a FAL_KEY available in the build environment
(same situation spike/research/image-to-3d-import.md recorded: "No live test
was run from this session"). The request-argument names below
(`image_url`, `should_texture`, `enable_pbr`, `topology`, `target_polycount`,
`auto_size`, `origin_at`) are the plan's own vocabulary (poc3-plan.md sec.4:
"smart topology ~15k, PBR on, auto_size: true, origin_at: bottom") combined
with Meshy's published API field names where the plan didn't spell out the
literal fal wire format. The fal model page for fal-ai/meshy/v6/image-to-3d
was not fetchable to confirm the exact schema at write time.

Before the first real run:
  1. Check the live schema at https://fal.ai/models/fal-ai/meshy/v6/image-to-3d/api
     (or `fal_client.run` against a trivial input and read the validation error --
     fal's queue API echoes back unknown-field errors, which is a fast way to
     discover the true field names without spending a full generation).
  2. If field names differ, they only need updating in ARGUMENT_DEFAULTS /
     build_arguments() below -- everything else (upload, download, validation,
     manifest wiring) is independent of the exact schema.
  3. The response-parsing side (extract_glb_url) is defensively written to
     search the result for anything that looks like a GLB URL if the expected
     keys aren't found, specifically so a schema mismatch fails loudly with the
     raw response printed, rather than silently downloading the wrong asset.
--------------------------------------------------------------------------
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

try:
    import fal_client
    import httpx
except ImportError:
    print(
        "Missing dependency 'fal-client' (and/or 'httpx').\n"
        "  Run this script with uv instead (it will install deps automatically):\n"
        "    uv run generate-item.py --image ... --item ...\n"
        "  ...or install it yourself:\n"
        "    pip install fal-client httpx",
        file=sys.stderr,
    )
    sys.exit(1)

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUT_DIR = SCRIPT_DIR / "glb"

ENDPOINT = "fal-ai/meshy/v6/image-to-3d"

# Best-effort defaults per poc3-plan.md sec.4 (W-A). See the module docstring's
# "UNTESTED AGAINST THE LIVE API" section -- verify these field names against
# the live schema before the first real run.
ARGUMENT_DEFAULTS = {
    "should_texture": True,
    "enable_pbr": True,
    "topology": "triangle",       # "smart topology ~15k" per the plan
    "target_polycount": 15000,
    "auto_size": True,
    "origin_at": "bottom",
}

# Candidate key-paths (dot-separated) to look for the output GLB URL in the
# fal response, tried in order. Meshy/fal image-to-3D endpoints have been
# observed (across versions/docs) to use various shapes for this; we don't
# know which one this endpoint uses without a live call.
GLB_URL_KEY_CANDIDATES = [
    "model_mesh.url",
    "model_glb.url",
    "glb.url",
    "output.model_mesh.url",
    "model_urls.glb",
    "mesh.url",
]


def is_url(s: str) -> bool:
    try:
        return urlparse(s).scheme in ("http", "https")
    except ValueError:
        return False


def get_by_path(d: dict, path: str):
    cur = d
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def find_glb_url_anywhere(obj) -> str | None:
    """Fallback: walk the whole response looking for any string that looks
    like a URL ending in .glb (case-insensitive, tolerating query strings)."""
    if isinstance(obj, str):
        lowered = obj.split("?", 1)[0].lower()
        if is_url(obj) and lowered.endswith(".glb"):
            return obj
        return None
    if isinstance(obj, dict):
        for v in obj.values():
            found = find_glb_url_anywhere(v)
            if found:
                return found
        return None
    if isinstance(obj, list):
        for v in obj:
            found = find_glb_url_anywhere(v)
            if found:
                return found
        return None
    return None


def extract_glb_url(result: dict) -> str:
    for path in GLB_URL_KEY_CANDIDATES:
        val = get_by_path(result, path)
        if isinstance(val, str) and val:
            return val
    fallback = find_glb_url_anywhere(result)
    if fallback:
        print(
            f"  (note: GLB URL not found at a known key path, "
            f"found by fallback scan instead: {fallback})",
            file=sys.stderr,
        )
        return fallback
    print(
        "ERROR: could not find a GLB URL anywhere in the fal response.\n"
        "This almost certainly means the response schema doesn't match this "
        "script's assumptions (see the module docstring). Full response:\n"
        + json.dumps(result, indent=2, default=str),
        file=sys.stderr,
    )
    sys.exit(1)


def on_queue_update(update):
    if isinstance(update, fal_client.InProgress):
        for log in update.logs:
            print(f"  [queue] {log.get('message', log)}")
    else:
        print(f"  [queue] {type(update).__name__}")


def validate_environment(args) -> Path:
    """Fail fast with clear messages before spending any API calls."""
    if not os.environ.get("FAL_KEY"):
        print(
            "FAL_KEY environment variable is not set.\n"
            "  Get a key at https://fal.ai/dashboard/keys and run:\n"
            "    export FAL_KEY=your-key-here\n"
            "  (per poc3-plan.md sec.5: pass it inline per run, never commit it.)",
            file=sys.stderr,
        )
        sys.exit(1)

    if not is_url(args.image):
        image_path = Path(args.image)
        if not image_path.is_absolute():
            image_path = Path.cwd() / args.image
        if not image_path.exists():
            print(f"Image not found at {image_path}", file=sys.stderr)
            sys.exit(1)
        if not image_path.is_file():
            print(f"--image path is not a file: {image_path}", file=sys.stderr)
            sys.exit(1)

    out_dir = Path(args.out) if args.out else DEFAULT_OUT_DIR
    if not out_dir.is_absolute():
        out_dir = Path.cwd() / out_dir
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        probe = out_dir / ".write-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
    except OSError as e:
        print(f"Output directory {out_dir} is not writable: {e}", file=sys.stderr)
        sys.exit(1)

    return out_dir


def build_arguments(image_url: str, args) -> dict:
    request_args = dict(ARGUMENT_DEFAULTS)
    request_args["image_url"] = image_url
    if args.topology:
        request_args["topology"] = args.topology
    if args.target_polycount:
        request_args["target_polycount"] = args.target_polycount
    if args.no_pbr:
        request_args["enable_pbr"] = False
    return request_args


def main():
    parser = argparse.ArgumentParser(
        description="Submit one item image to fal-ai/meshy/v6/image-to-3d and "
        "download the resulting GLB (PoC 3 / W-A / D1)."
    )
    parser.add_argument(
        "--image", required=True,
        help="Path to a local image file, or an http(s) URL to one.",
    )
    parser.add_argument(
        "--item", required=True,
        help="Item id, e.g. swivel-chair / shoe-cabinet / bookshelf "
        "(matches spike/import/items.json ids). Used to name the output file.",
    )
    parser.add_argument(
        "--out", default=None,
        help=f"Output directory for the GLB (default: {DEFAULT_OUT_DIR}).",
    )
    parser.add_argument(
        "--topology", default=None, choices=["triangle", "quad"],
        help="Override topology (default from ARGUMENT_DEFAULTS: triangle).",
    )
    parser.add_argument(
        "--target-polycount", dest="target_polycount", type=int, default=None,
        help="Override target polycount (default from ARGUMENT_DEFAULTS: 15000, "
        "i.e. 'smart topology ~15k' per poc3-plan.md).",
    )
    parser.add_argument(
        "--no-pbr", action="store_true",
        help="Disable enable_pbr (default is PBR on, per the plan).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Validate everything (FAL_KEY, image, output dir, fal_client "
        "importability) and print the request that WOULD be sent, without "
        "calling the API.",
    )
    args = parser.parse_args()

    out_dir = validate_environment(args)

    if is_url(args.image):
        image_url = args.image
        print(f"Using image URL directly: {image_url}")
    else:
        image_path = Path(args.image)
        if not image_path.is_absolute():
            image_path = Path.cwd() / image_path
        if args.dry_run:
            image_url = f"<would-upload:{image_path}>"
        else:
            print(f"Uploading image: {image_path}")
            image_url = fal_client.upload_file(str(image_path))
            print(f"  -> {image_url}")

    request_args = build_arguments(image_url, args)

    print(
        f"\nEndpoint: {ENDPOINT}\n"
        f"Item: {args.item}\n"
        f"Request arguments:\n{json.dumps(request_args, indent=2)}\n"
    )

    out_path = out_dir / f"{args.item}.glb"

    if args.dry_run:
        print(f"[dry-run] Would write GLB to: {out_path}")
        print("[dry-run] No API call made.")
        return

    print("Submitting to fal.ai (this can take ~1-4 minutes per the research memo) ...")
    result = fal_client.subscribe(
        ENDPOINT,
        arguments=request_args,
        with_logs=True,
        on_queue_update=on_queue_update,
    )

    glb_url = extract_glb_url(result)
    print(f"Downloading GLB from {glb_url}")
    resp = httpx.get(glb_url, follow_redirects=True, timeout=300)
    resp.raise_for_status()
    out_path.write_bytes(resp.content)
    print(f"Wrote {out_path} ({len(resp.content)} bytes)")

    meta_path = out_dir / f"{args.item}.meta.json"
    meta = {
        "item": args.item,
        "endpoint": ENDPOINT,
        "request_args": {k: v for k, v in request_args.items() if k != "image_url"},
        "response_meta": {k: v for k, v in result.items()},
    }
    meta_path.write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")
    print(f"Wrote metadata: {meta_path}")
    print(
        "\nNext step: process this GLB with process-glb.mjs to rescale to "
        "known cm dims, floor-snap, and recenter -- see spike/import/README.md."
    )


if __name__ == "__main__":
    main()
