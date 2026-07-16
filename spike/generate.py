# /// script
# requires-python = ">=3.9"
# dependencies = ["fal-client"]
# ///
"""
generate.py - throwaway spike script for depth-conditioned AI image generation.

Sends a depth map to a fal.ai depth-conditioned image model (FLUX Control LoRA
Depth by default, or SD1.5 Depth ControlNet as a fallback), saves the
generated variations to out/, and rebuilds an HTML contact sheet of every run
found in out/ so a human can eyeball results side by side.

Run with:
    uv run generate.py
or:
    python3 generate.py   (after `pip install fal-client`)

Requires the FAL_KEY environment variable to be set (https://fal.ai/dashboard/keys).
"""

from __future__ import annotations

import argparse
import glob
import html
import json
import os
import sys
import time
from pathlib import Path

try:
    import fal_client
    import httpx  # fal-client dependency; used for downloads (urllib lacks
    # CA certs on framework Python installs, httpx bundles certifi)
except ImportError:
    print(
        "Missing dependency 'fal-client'.\n"
        "  Run this script with uv instead (it will install deps automatically):\n"
        "    uv run generate.py\n"
        "  ...or install it yourself:\n"
        "    pip install fal-client",
        file=sys.stderr,
    )
    sys.exit(1)

SCRIPT_DIR = Path(__file__).resolve().parent
OUT_DIR = SCRIPT_DIR / "out"

# --- Endpoint definitions -----------------------------------------------
#
# Schemas pulled from https://fal.ai/models/fal-ai/flux-control-lora-depth/api
# and (best-effort, page was returning 404 at write time; corroborated via
# search results and fal's other ControlNet-style endpoints) for the SD1.5
# depth controlnet at https://fal.ai/models/fal-ai/sd15-depth-controlnet/api.
#
# Pricing:
#   flux-control-lora-depth: confirmed on the model page at $0.04 / megapixel,
#     rounded up to the nearest megapixel. (Spike brief estimated ~$0.075/MP;
#     the live page said $0.04/MP as of 2026-07-17 -- using the page value.)
#   sd15-depth-controlnet: pricing was not retrievable (API/pricing pages
#     404'd). Using a conservative estimate of $0.01/image, the middle of the
#     $0.005-0.02/image range noted in the spike brief. Treat this number as
#     approximate.

FLUX_ENDPOINT = "fal-ai/flux-control-lora-depth"
SD15_ENDPOINT = "fal-ai/sd15-depth-controlnet"

FLUX_PRICE_PER_MP = 0.04  # USD per megapixel, rounded up
SD15_PRICE_PER_IMAGE = 0.01  # USD per image, approximate (see note above)

FLUX_IMAGE_SIZES = {
    "square_hd",
    "square",
    "portrait_4_3",
    "portrait_16_9",
    "landscape_4_3",
    "landscape_16_9",
}
# The flux endpoint's max num_images per request isn't documented reliably,
# so we conservatively issue one request per image (per seed) rather than
# trusting a batch size we can't confirm.
FLUX_MAX_NUM_IMAGES_PER_REQUEST = 1
SD15_MAX_NUM_IMAGES_PER_REQUEST = 4


def parse_size(size_str: str) -> tuple[int, int]:
    try:
        w_str, h_str = size_str.lower().split("x")
        return int(w_str), int(h_str)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"--size must be WxH (e.g. 1024x768), got {size_str!r}"
        )


def build_image_size_param(model: str, width: int, height: int):
    """Both endpoints accept either a named enum size or a {width,height} object.
    We always pass the explicit width/height object so --size is honored exactly,
    since the enum values are coarse aspect-ratio buckets."""
    return {"width": width, "height": height}


def read_prompt(args) -> str:
    if args.prompt:
        return args.prompt
    prompt_path = Path(args.prompt_file)
    if not prompt_path.is_absolute():
        prompt_path = SCRIPT_DIR / args.prompt_file
    if not prompt_path.exists():
        print(
            f"No prompt found. Expected a prompt file at {prompt_path}\n"
            "  Either create that file with your prompt text, or pass one "
            "directly with --prompt \"...\".",
            file=sys.stderr,
        )
        sys.exit(1)
    text = prompt_path.read_text(encoding="utf-8").strip()
    if not text:
        print(f"Prompt file {prompt_path} is empty.", file=sys.stderr)
        sys.exit(1)
    return text


def on_queue_update(update):
    if isinstance(update, fal_client.InProgress):
        for log in update.logs:
            print(f"  [queue] {log.get('message', log)}")
    else:
        print(f"  [queue] {type(update).__name__}")


def build_arguments(model: str, depth_url: str, prompt: str, scale: float,
                     width: int, height: int, seed: int | None):
    if model == "flux":
        args = {
            "prompt": prompt,
            "control_lora_image_url": depth_url,
            "control_lora_strength": scale,
            "image_size": build_image_size_param(model, width, height),
            "num_images": 1,
        }
    else:  # sd15
        args = {
            "prompt": prompt,
            "image_url": depth_url,
            "controlnet_conditioning_scale": scale,
            "image_size": build_image_size_param(model, width, height),
            "num_images": 1,
        }
    if seed is not None:
        args["seed"] = seed
    return args


def estimate_cost(model: str, width: int, height: int, n: int) -> float:
    if model == "flux":
        megapixels = (width * height) / 1_000_000
        import math

        mp_rounded = math.ceil(megapixels)
        return mp_rounded * FLUX_PRICE_PER_MP * n
    else:
        return SD15_PRICE_PER_IMAGE * n


def main():
    parser = argparse.ArgumentParser(
        description="Send a depth map to a fal.ai depth-conditioned image model "
        "and build an HTML contact sheet of the results."
    )
    parser.add_argument(
        "--depth",
        default=str(SCRIPT_DIR / "out" / "depth.png"),
        help="Path to the depth map image (default: out/depth.png next to this script)",
    )
    parser.add_argument(
        "--prompt-file",
        default="prompt.txt",
        help="Path to a text file containing the prompt (default: prompt.txt next to this script)",
    )
    parser.add_argument(
        "--prompt",
        default=None,
        help="Prompt text, overrides --prompt-file if given",
    )
    parser.add_argument(
        "--n", type=int, default=5, help="Number of variations to generate (default: 5)"
    )
    parser.add_argument(
        "--scale",
        type=float,
        default=None,
        help="Conditioning/control strength. Default: 1.0 for flux, 0.5 for sd15 "
        "(the endpoints' own defaults).",
    )
    parser.add_argument(
        "--model",
        choices=["flux", "sd15"],
        default="flux",
        help="Which depth-conditioned model to use (default: flux)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Base seed. If given with --n>1, uses seed, seed+1, seed+2, ...",
    )
    parser.add_argument(
        "--size",
        type=parse_size,
        default="1024x768",
        help="Output image size as WxH (default: 1024x768)",
    )
    args = parser.parse_args()

    if not os.environ.get("FAL_KEY"):
        print(
            "FAL_KEY environment variable is not set.\n"
            "  Get a key at https://fal.ai/dashboard/keys and run:\n"
            "    export FAL_KEY=your-key-here",
            file=sys.stderr,
        )
        sys.exit(1)

    depth_path = Path(args.depth)
    if not depth_path.is_absolute():
        depth_path = SCRIPT_DIR / args.depth
    if not depth_path.exists():
        print(f"Depth map not found at {depth_path}", file=sys.stderr)
        sys.exit(1)

    prompt = read_prompt(args)
    width, height = args.size if isinstance(args.size, tuple) else parse_size(args.size)

    endpoint = FLUX_ENDPOINT if args.model == "flux" else SD15_ENDPOINT
    scale = args.scale if args.scale is not None else (1.0 if args.model == "flux" else 0.5)
    max_per_request = (
        FLUX_MAX_NUM_IMAGES_PER_REQUEST
        if args.model == "flux"
        else SD15_MAX_NUM_IMAGES_PER_REQUEST
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Uploading depth map: {depth_path}")
    depth_url = fal_client.upload_file(str(depth_path))
    print(f"  -> {depth_url}")

    seeds: list[int | None]
    if args.seed is not None:
        seeds = [args.seed + i for i in range(args.n)]
    else:
        seeds = [None] * args.n

    est_cost = estimate_cost(args.model, width, height, args.n)
    per_image_cost = est_cost / args.n if args.n else 0
    print(
        f"\nModel: {endpoint}\n"
        f"Prompt: {prompt}\n"
        f"Size: {width}x{height}  Scale: {scale}  N: {args.n}\n"
        f"Estimated cost: ~${per_image_cost:.4f}/image, ~${est_cost:.4f} total\n"
    )

    timestamp = time.strftime("%Y%m%d-%H%M%S")
    results_meta = []
    image_index = 0

    # Requests: chunk args.n into batches of max_per_request images each.
    remaining = args.n
    seed_cursor = 0
    while remaining > 0:
        batch_n = min(max_per_request, remaining)
        batch_seed = seeds[seed_cursor]
        request_args = build_arguments(
            args.model, depth_url, prompt, scale, width, height, batch_seed
        )
        if max_per_request > 1:
            request_args["num_images"] = batch_n

        print(f"Submitting request (batch of {batch_n}, seed={batch_seed}) ...")
        result = fal_client.subscribe(
            endpoint,
            arguments=request_args,
            with_logs=True,
            on_queue_update=on_queue_update,
        )

        images = result.get("images", [])
        returned_seed = result.get("seed", batch_seed)
        for i, image in enumerate(images):
            image_index += 1
            url = image["url"]
            out_path = OUT_DIR / f"run-{timestamp}-{image_index}.png"
            print(f"  Downloading image {image_index} -> {out_path}")
            resp = httpx.get(url, follow_redirects=True, timeout=120)
            resp.raise_for_status()
            out_path.write_bytes(resp.content)

        results_meta.append(
            {
                "endpoint": endpoint,
                "request_args": request_args,
                "seed": returned_seed,
                "prompt": prompt,
                "image_files": [
                    f"run-{timestamp}-{image_index - len(images) + 1 + j}.png"
                    for j in range(len(images))
                ],
                "response_meta": {
                    k: v for k, v in result.items() if k != "images"
                },
            }
        )

        remaining -= batch_n
        seed_cursor += batch_n

    run_json_path = OUT_DIR / f"run-{timestamp}.json"
    run_record = {
        "timestamp": timestamp,
        "model": args.model,
        "endpoint": endpoint,
        "prompt": prompt,
        "scale": scale,
        "size": {"width": width, "height": height},
        "n": args.n,
        "base_seed": args.seed,
        "estimated_cost_usd": est_cost,
        "batches": results_meta,
    }
    run_json_path.write_text(json.dumps(run_record, indent=2), encoding="utf-8")
    print(f"\nWrote run metadata: {run_json_path}")

    contact_sheet_path = build_contact_sheet(depth_path)
    print(f"\nEstimated cost this run: ~${est_cost:.4f} ({args.n} image(s))")
    print(f"Contact sheet: {contact_sheet_path}")


def build_contact_sheet(depth_path: Path) -> Path:
    """Scan out/run-*.json (skipping run-*-<n>.png images, which aren't json)
    and rebuild out/contact-sheet.html, newest run first."""
    run_files = sorted(glob.glob(str(OUT_DIR / "run-*.json")), reverse=True)

    rows = []
    for run_file in run_files:
        try:
            data = json.loads(Path(run_file).read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            print(f"  Warning: skipping unreadable run file {run_file}: {e}")
            continue

        image_files = []
        for batch in data.get("batches", []):
            image_files.extend(batch.get("image_files", []))

        summary_bits = [
            f"<b>{html.escape(data.get('timestamp', '?'))}</b>",
            f"model={html.escape(str(data.get('model', '?')))}",
            f"endpoint={html.escape(str(data.get('endpoint', '?')))}",
            f"scale={html.escape(str(data.get('scale', '?')))}",
            f"size={data.get('size', {}).get('width', '?')}x{data.get('size', {}).get('height', '?')}",
            f"n={data.get('n', '?')}",
            f"seed={html.escape(str(data.get('base_seed', 'random')))}",
            f"est. cost=${data.get('estimated_cost_usd', 0):.4f}",
        ]
        prompt_line = html.escape(data.get("prompt", ""))

        thumbs = "\n".join(
            f'''<a href="{html.escape(fname)}" target="_blank">
                  <img src="{html.escape(fname)}" style="width:480px;margin:4px;border:1px solid #444;" />
                </a>'''
            for fname in image_files
            if (OUT_DIR / fname).exists()
        )

        rows.append(
            f'''<div style="border-bottom:1px solid #333;padding:16px 0;">
                  <div style="font-family:monospace;font-size:13px;color:#ccc;margin-bottom:6px;">
                    {" &nbsp;|&nbsp; ".join(summary_bits)}
                  </div>
                  <div style="font-family:sans-serif;font-size:13px;color:#999;margin-bottom:8px;max-width:960px;">
                    {prompt_line}
                  </div>
                  <div style="display:flex;flex-wrap:wrap;">
                    {thumbs}
                  </div>
                </div>'''
        )

    depth_rel = os.path.relpath(depth_path, OUT_DIR)
    depth_img_html = ""
    if depth_path.exists():
        depth_img_html = (
            f'<img src="{html.escape(depth_rel)}" style="width:480px;border:1px solid #444;" />'
        )

    page = f'''<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Depth spike contact sheet</title>
</head>
<body style="background:#111;color:#eee;font-family:sans-serif;margin:0;padding:24px;">
  <h1 style="font-size:20px;">Depth-conditioned rendering spike</h1>
  <div style="margin-bottom:24px;">
    <div style="font-size:13px;color:#999;margin-bottom:6px;">Input depth map</div>
    {depth_img_html}
  </div>
  <h2 style="font-size:16px;color:#aaa;">Runs (newest first)</h2>
  {"".join(rows) if rows else '<div style="color:#666;">No runs found yet in out/</div>'}
</body>
</html>
'''
    contact_sheet_path = OUT_DIR / "contact-sheet.html"
    contact_sheet_path.write_text(page, encoding="utf-8")
    return contact_sheet_path.resolve()


if __name__ == "__main__":
    main()
