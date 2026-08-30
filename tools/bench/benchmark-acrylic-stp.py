#!/usr/bin/env python3
"""Run the Acrylic backlog benchmark in Safari Technology Preview via Safari MCP."""

import argparse
import base64
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


WORK_DIR = Path(__file__).resolve().parent
RESULT_DIR = WORK_DIR / "results"
CLIENT_PATH = WORK_DIR / "safari-mcp-client.py"
LONG_STROKE_PATH = WORK_DIR / "acrylic-longstroke.page.js"
PARITY_PATH = WORK_DIR / "acrylic-parity.page.js"
EVALUATE_TIMEOUT_SECONDS = 900

RAF_PROBE_BODY = r"""
return new Promise((resolve) => {
  const startedAt = performance.now();
  let rafCount = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    resolve(JSON.stringify({
      visibility: document.visibilityState,
      rafIn1000ms: rafCount,
      elapsedMs: performance.now() - startedAt,
    }));
  };
  const tick = (now) => {
    if (now - startedAt >= 1000) {
      finish();
      return;
    }
    rafCount++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setTimeout(finish, 1500);
});
"""

SELECT_ACRYLIC_BODY = r"""
return new Promise((resolve, reject) => {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === "Acrylic",
  );
  if (!button) {
    reject(new Error("Acrylic button was not found"));
    return;
  }
  button.click();
  const deadline = performance.now() + 15000;
  const waitForCanvas = () => {
    const canvas = document.querySelector("canvas[data-headless-paint-main]");
    if (canvas) {
      globalThis.__hpBrushPerf?.reset();
      globalThis.__hpUndoTiming?.reset();
      globalThis.__acrylicCanvasPerf?.reset();
      resolve(JSON.stringify({ canvasFound: true }));
      return;
    }
    if (performance.now() >= deadline) {
      reject(new Error("timed out waiting for the main canvas"));
      return;
    }
    setTimeout(waitForCanvas, 50);
  };
  waitForCanvas();
});
"""

UNDO_BODY = r"""
const strokeCount = __STROKE_COUNT__;
return (async () => {
  const element = document.querySelector("canvas[data-headless-paint-main]");
  if (!element) {
    throw new Error("canvas[data-headless-paint-main] was not found");
  }

  for (let strokeIndex = 0; strokeIndex < strokeCount; strokeIndex++) {
    const rect = element.getBoundingClientRect();
    const pointerId = 1200 + strokeIndex;
    const y = rect.top + rect.height * (0.25 + (strokeIndex % 10) * 0.05);
    const event = (type, x, buttons, pressure = 0.62) =>
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "pen",
        isPrimary: true,
        buttons,
        pressure,
        clientX: x,
        clientY: y,
      });
    element.dispatchEvent(event("pointerdown", rect.left + rect.width * 0.3, 1));
    for (let step = 1; step <= 8; step++) {
      const move = event(
        "pointermove",
        rect.left + rect.width * (0.3 + step * 0.045),
        1,
      );
      Object.defineProperty(move, "getCoalescedEvents", { value: () => [] });
      element.dispatchEvent(move);
    }
    element.dispatchEvent(
      event("pointerup", rect.left + rect.width * 0.66, 0, 0),
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  }

  globalThis.__hpUndoTiming?.reset();
  const undo = document.querySelector('[aria-label="Undo"]');
  if (!undo) throw new Error("Undo button was not found");
  undo.click();

  const deadline = performance.now() + 30000;
  while ((globalThis.__hpUndoTiming?.entries.length ?? 0) === 0) {
    if (performance.now() >= deadline) {
      throw new Error("timed out waiting for __hpUndoTiming");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return JSON.stringify({
    replayedStrokes: strokeCount - 1,
    timing: globalThis.__hpUndoTiming?.snapshot().at(-1) ?? null,
  });
})();
"""

UNDO_TIMING_BODY = r"""
const replayedStrokes = __REPLAYED_STROKES__;
return (async () => {
  globalThis.__hpUndoTiming?.reset();
  const undo = document.querySelector('[aria-label="Undo"]');
  if (!undo) throw new Error("Undo button was not found");
  undo.click();

  const deadline = performance.now() + 30000;
  while ((globalThis.__hpUndoTiming?.entries.length ?? 0) === 0) {
    if (performance.now() >= deadline) {
      throw new Error("timed out waiting for __hpUndoTiming");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return JSON.stringify({
    replayedStrokes,
    timing: globalThis.__hpUndoTiming?.snapshot().at(-1) ?? null,
  });
})();
"""


def load_client_module():
    spec = importlib.util.spec_from_file_location("safari_mcp_client", CLIENT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load Safari MCP client: {CLIENT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("BASE_URL", "http://127.0.0.1:5183"))
    parser.add_argument(
        "--gpu-backend",
        choices=("cpu", "webgl2"),
        default=os.environ.get("GPU_BACKEND", "cpu"),
    )
    parser.add_argument(
        "--batches",
        type=positive_int,
        default=positive_int(os.environ.get("BATCHES", "240")),
    )
    parser.add_argument(
        "--samples",
        type=positive_int,
        default=positive_int(os.environ.get("SAMPLES", "8")),
    )
    parser.add_argument(
        "--repeats",
        type=positive_int,
        default=positive_int(os.environ.get("REPEATS", "1")),
    )
    parser.add_argument(
        "--undo-strokes",
        type=positive_int,
        default=positive_int(os.environ.get("UNDO_STROKES", "3")),
    )
    parser.add_argument(
        "--checkpoint-lag",
        type=positive_int,
        default=positive_int(os.environ.get("CHECKPOINT_LAG", "1")),
    )
    parser.add_argument(
        "--parity",
        action="store_true",
        help="run the three CPU/GPU Acrylic parity fixtures and save screenshots",
    )
    return parser.parse_args()


def benchmark_url(
    base_url: str,
    gpu_backend: str,
    checkpoint_lag: int,
) -> str:
    parts = urlsplit(base_url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update(
        {
            "perfDebug": "1",
            "gpuBackend": gpu_backend,
            "checkpointLag": str(checkpoint_lag),
        }
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def decode_json_result(text: str):
    value = text.strip()
    for _ in range(3):
        if not isinstance(value, str):
            return value
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"Safari MCP returned non-JSON output: {text[:500]}") from error
    return value


def activate_stp() -> None:
    subprocess.run(
        [
            "osascript",
            "-e",
            'tell application "Safari Technology Preview" to activate',
        ],
        timeout=15,
        capture_output=True,
        check=False,
    )
    time.sleep(1.5)


def navigate(client, url: str) -> None:
    client.tool("navigate_to_url", {"url": url}, 120)


def run_raf_probe(client) -> dict:
    deadline = time.time() + 120
    probe = None
    while time.time() < deadline:
        probe = decode_json_result(client.evaluate(RAF_PROBE_BODY, 10))
        if not isinstance(probe, dict):
            raise RuntimeError(f"unexpected rAF probe result: {probe!r}")
        if probe.get("visibility") == "visible" and probe.get("rafIn1000ms", 0) >= 50:
            return probe
        print("waiting for STP window to become visible (click it)...", flush=True)
        time.sleep(3)
    if probe.get("visibility") != "visible" or probe.get("rafIn1000ms", 0) < 50:
        raise RuntimeError(
            "rAF probe failed; aborting benchmark "
            f"(visibility={probe.get('visibility')}, "
            f"rafIn1000ms={probe.get('rafIn1000ms')})"
        )
    return probe


def prepare_page(client, url: str) -> dict:
    navigate(client, url)
    client.evaluate("localStorage.clear(); return JSON.stringify({ cleared: true });", 30)
    navigate(client, url)
    activate_stp()
    probe = run_raf_probe(client)
    decode_json_result(client.evaluate(SELECT_ACRYLIC_BODY, 30))
    return probe


def load_long_stroke_body() -> str:
    source = LONG_STROKE_PATH.read_text(encoding="utf-8")
    prefix = "export const LONG_STROKE_BODY = `"
    suffix = "`;"
    if not source.startswith(prefix) or not source.rstrip().endswith(suffix):
        raise RuntimeError(f"unexpected LONG_STROKE_BODY module format: {LONG_STROKE_PATH}")
    end = source.rfind(suffix)
    return source[len(prefix) : end]


def load_parity_body() -> str:
    source = PARITY_PATH.read_text(encoding="utf-8")
    prefix = "export const ACRYLIC_PARITY_BODY = `"
    suffix = "`;"
    if not source.startswith(prefix) or not source.rstrip().endswith(suffix):
        raise RuntimeError(f"unexpected ACRYLIC_PARITY_BODY module format: {PARITY_PATH}")
    end = source.rfind(suffix)
    return source[len(prefix) : end]


def long_stroke_script(batch_count: int, samples_per_batch: int) -> str:
    body = (
        load_long_stroke_body()
        .replace("__BATCHES__", str(batch_count))
        .replace("__SAMPLES__", str(samples_per_batch))
        .rstrip()
    )
    ending = "})();"
    if not body.endswith(ending):
        raise RuntimeError("LONG_STROKE_BODY must return an async IIFE")
    body = body[: -len(ending)] + "})().then((result) => JSON.stringify(result));"
    return 'const element = document.querySelector("canvas[data-headless-paint-main]");\n' + body


def parity_script(backend: str) -> str:
    body = load_parity_body().rstrip()
    ending = "})();"
    if not body.endswith(ending):
        raise RuntimeError("ACRYLIC_PARITY_BODY must return an async IIFE")
    body = body[: -len(ending)] + "})().then((result) => JSON.stringify(result));"
    return (
        'const element = document.querySelector("canvas[data-headless-paint-main]");\n'
        f"const benchmarkOptions = {{ backend: {json.dumps(backend)} }};\n"
        + body
    )


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, math.floor(len(ordered) * fraction))
    return ordered[index]


def summarize(values: list[float]) -> dict:
    quarter = max(1, len(values) // 4)
    return {
        "p50": round(percentile(values, 0.5), 1),
        "p95": round(percentile(values, 0.95), 1),
        "max": round(max([0.0, *values]), 1),
        "earlyP50": round(percentile(values[:quarter], 0.5), 1),
        "lateP50": round(percentile(values[-quarter:], 0.5), 1),
    }


def run_long_stroke(client, batch_count: int, samples_per_batch: int) -> dict:
    result = decode_json_result(
        client.evaluate(
            long_stroke_script(batch_count, samples_per_batch),
            EVALUATE_TIMEOUT_SECONDS,
        )
    )
    return {
        "samples": result["sampleIndex"],
        "dispatch": summarize(result["dispatchMs"]),
        "frame": summarize(result["frameMs"]),
        "scheduleLag": summarize(result["scheduleLagMs"]),
        "drainMs": round(result["drainMs"], 3),
        "canvasPerf": result.get("canvasPerf"),
        "stageSnapshot": result.get("stageSnapshot"),
    }


def measure_undo(client, stroke_count: int) -> dict:
    script = UNDO_BODY.replace("__STROKE_COUNT__", str(stroke_count))
    result = decode_json_result(client.evaluate(script, EVALUATE_TIMEOUT_SECONDS))
    if not isinstance(result, dict) or result.get("timing") is None:
        raise RuntimeError(f"unexpected undo result: {result!r}")
    return result


def measure_long_undo(
    client,
    stroke_count: int,
    batch_count: int,
    samples_per_batch: int,
) -> dict:
    for _ in range(stroke_count):
        client.evaluate(
            long_stroke_script(batch_count, samples_per_batch),
            EVALUATE_TIMEOUT_SECONDS,
        )
    script = UNDO_TIMING_BODY.replace("__REPLAYED_STROKES__", str(stroke_count - 1))
    result = decode_json_result(client.evaluate(script, EVALUATE_TIMEOUT_SECONDS))
    if not isinstance(result, dict) or result.get("timing") is None:
        raise RuntimeError(f"unexpected long undo result: {result!r}")
    return {
        "strokes": stroke_count,
        "samplesPerStroke": batch_count * samples_per_batch,
        **result,
    }


def stage_metric(payload: dict, name: str) -> tuple[int, float]:
    snapshot = payload["longStroke"].get("stageSnapshot") or {}
    metric = (snapshot.get("stages") or {}).get(name) or {}
    return int(metric.get("count", 0)), float(metric.get("totalMs", 0))


def print_summary(payload: dict, output_path: Path) -> None:
    dispatch = payload["longStroke"]["dispatch"]
    stage_parts = []
    for name in ("gpuReadRequest", "gpuCommit", "checkpointReadback"):
        count, total_ms = stage_metric(payload, name)
        stage_parts.append(f"{name}={count}/{total_ms:.1f}ms")
    undo1 = payload["undo1"]["timing"]
    undo9 = payload["undo9"]["timing"]
    undo_long = payload["undoLong"]["timing"]
    print(
        f"{output_path.name} dispatch={dispatch['p50']:.1f}/{dispatch['p95']:.1f}ms "
        + " ".join(stage_parts)
        + f" undo1={undo1['durationMs']:.1f}ms+{undo1['drainMs']:.1f}ms"
        + f" undo9={undo9['durationMs']:.1f}ms+{undo9['drainMs']:.1f}ms"
        + f" undoLong={undo_long['durationMs']:.1f}ms+{undo_long['drainMs']:.1f}ms"
    )


def save_screenshot(client, output_path: Path) -> None:
    _, response = client.tool("screenshot", {}, 120)
    for content in response.get("content", []):
        if content.get("type") == "image" and content.get("data"):
            output_path.write_bytes(base64.b64decode(content["data"]))
            return
        resource = content.get("resource") or {}
        if content.get("type") == "resource" and resource.get("blob"):
            output_path.write_bytes(base64.b64decode(resource["blob"]))
            return
    raise RuntimeError("Safari MCP screenshot tool returned no image content")


def print_parity_summary(fixture: dict) -> None:
    metric = fixture["metrics"]
    print(
        f"{fixture['id']} "
        f"coverage={metric['coverageRelativeDifference']:.5f} "
        f"alphaMAE={metric['alphaMae']:.5f} "
        f"rgbMAE={metric['rgbMae']:.5f} "
        f"delta>0.1={metric['overPointOneRate']:.5f} "
        f"bbox={metric['bboxEdgeMax']}px "
        f"pass={str(metric['pass']).lower()} "
        f"undo={fixture['cpuUndoDifferentChannels']}/"
        f"{fixture['gpuUndoDifferentChannels']}"
    )


def decode_image(image: dict) -> dict:
    return {
        "width": int(image["width"]),
        "height": int(image["height"]),
        "data": base64.b64decode(image["data"]),
    }


def changed_from(pixels: bytes, baseline: bytes, pixel_index: int) -> bool:
    offset = pixel_index * 4
    return any(abs(pixels[offset + channel] - baseline[offset + channel]) > 1 for channel in range(4))


def bbox_for(pixels: bytes, baseline: bytes, width: int, height: int) -> dict:
    left, top, right, bottom, coverage = width, height, -1, -1, 0
    for y in range(height):
        for x in range(width):
            pixel_index = y * width + x
            if not changed_from(pixels, baseline, pixel_index):
                continue
            coverage += 1
            left, top = min(left, x), min(top, y)
            right, bottom = max(right, x), max(bottom, y)
    return {
        "coverage": coverage,
        "bbox": None if coverage == 0 else {"left": left, "top": top, "right": right, "bottom": bottom},
    }


def calculate_parity_metrics(baseline_image: dict, cpu_image: dict, gpu_image: dict) -> dict:
    width, height = cpu_image["width"], cpu_image["height"]
    if (baseline_image["width"], baseline_image["height"]) != (width, height) or (
        gpu_image["width"], gpu_image["height"]
    ) != (width, height):
        raise RuntimeError("CPU/GPU parity image dimensions differ")
    baseline, cpu, gpu = baseline_image["data"], cpu_image["data"], gpu_image["data"]
    cpu_shape = bbox_for(cpu, baseline, width, height)
    gpu_shape = bbox_for(gpu, baseline, width, height)
    union_coverage = alpha_error = rgb_error = over_threshold = 0
    for pixel_index in range(width * height):
        if not changed_from(cpu, baseline, pixel_index) and not changed_from(gpu, baseline, pixel_index):
            continue
        union_coverage += 1
        offset = pixel_index * 4
        deltas = [abs(cpu[offset + channel] - gpu[offset + channel]) for channel in range(4)]
        rgb_error += sum(deltas[:3])
        alpha_error += deltas[3]
        if max(deltas) / 255 > 0.1:
            over_threshold += 1
    edge_difference = {}
    bbox_edge_max = 0
    if cpu_shape["bbox"] and gpu_shape["bbox"]:
        for edge in ("left", "top", "right", "bottom"):
            difference = abs(cpu_shape["bbox"][edge] - gpu_shape["bbox"][edge])
            edge_difference[edge] = difference
            bbox_edge_max = max(bbox_edge_max, difference)
    elif cpu_shape["bbox"] != gpu_shape["bbox"]:
        bbox_edge_max = None
    denominator = max(1, union_coverage)
    coverage_relative_difference = abs(cpu_shape["coverage"] - gpu_shape["coverage"]) / max(
        1, cpu_shape["coverage"], gpu_shape["coverage"]
    )
    alpha_mae = alpha_error / denominator / 255
    rgb_mae = rgb_error / denominator / 3 / 255
    over_point_one_rate = over_threshold / denominator
    return {
        "source": "display-canvas-roi",
        "width": width,
        "height": height,
        "cpuCoverage": cpu_shape["coverage"],
        "gpuCoverage": gpu_shape["coverage"],
        "unionCoverage": union_coverage,
        "coverageRelativeDifference": coverage_relative_difference,
        "alphaMae": alpha_mae,
        "rgbMae": rgb_mae,
        "overPointOneRate": over_point_one_rate,
        "cpuBbox": cpu_shape["bbox"],
        "gpuBbox": gpu_shape["bbox"],
        "bboxEdgeDifference": edge_difference,
        "bboxEdgeMax": bbox_edge_max,
        "thresholds": {
            "alphaMae": 0.015,
            "rgbMae": 0.02,
            "overPointOneRate": 0.01,
            "bboxEdgeMax": 1,
        },
        "pass": (
            union_coverage > 0
            and alpha_mae <= 0.015
            and rgb_mae <= 0.02
            and over_point_one_rate <= 0.01
            and bbox_edge_max is not None
            and bbox_edge_max <= 1
        ),
    }


def compose_comparison(cpu: dict, gpu: dict) -> dict:
    width, height = cpu["width"], cpu["height"]
    output_width = width * 3
    output = bytearray(output_width * height * 4)
    for y in range(height):
        for x in range(width):
            source_offset = (y * width + x) * 4
            for panel in range(3):
                target_offset = (y * output_width + x + panel * width) * 4
                if panel == 0:
                    output[target_offset : target_offset + 4] = cpu["data"][source_offset : source_offset + 4]
                elif panel == 1:
                    output[target_offset : target_offset + 4] = gpu["data"][source_offset : source_offset + 4]
                else:
                    for channel in range(3):
                        output[target_offset + channel] = min(
                            255,
                            abs(cpu["data"][source_offset + channel] - gpu["data"][source_offset + channel]) * 4,
                        )
                    output[target_offset + 3] = 255
    return {"width": output_width, "height": height, "data": bytes(output)}


def show_parity_image(client, image: dict) -> None:
    encoded = base64.b64encode(image["data"]).decode("ascii")
    script = f"""
const data = {json.dumps(encoded)};
const binary = atob(data);
const pixels = new Uint8ClampedArray(binary.length);
for (let index = 0; index < binary.length; index++) pixels[index] = binary.charCodeAt(index);
document.body.replaceChildren();
document.body.style.margin = "0";
document.body.style.background = "#111";
const canvas = document.createElement("canvas");
canvas.width = {image['width']};
canvas.height = {image['height']};
canvas.style.width = "min(100vw, " + canvas.width + "px)";
canvas.style.height = "auto";
canvas.getContext("2d").putImageData(new ImageData(pixels, canvas.width, canvas.height), 0, 0);
document.body.append(canvas);
return JSON.stringify({{ shown: true }});
"""
    decode_json_result(client.evaluate(script, 60))


def run_parity(client, args: argparse.Namespace) -> None:
    cpu_url = benchmark_url(args.base_url, "cpu", args.checkpoint_lag)
    gpu_url = benchmark_url(args.base_url, "webgl2", args.checkpoint_lag)
    cpu_probe = prepare_page(client, cpu_url)
    cpu_run = decode_json_result(
        client.evaluate(parity_script("cpu"), EVALUATE_TIMEOUT_SECONDS)
    )
    gpu_probe = prepare_page(client, gpu_url)
    gpu_run = decode_json_result(
        client.evaluate(parity_script("webgl2"), EVALUATE_TIMEOUT_SECONDS)
    )
    output_directory = RESULT_DIR / "parity-safari-stp"
    output_directory.mkdir(parents=True, exist_ok=True)
    gpu_by_id = {fixture["id"]: fixture for fixture in gpu_run["fixtures"]}
    fixtures = []
    for cpu_fixture in cpu_run["fixtures"]:
        gpu_fixture = gpu_by_id.get(cpu_fixture["id"])
        if gpu_fixture is None:
            raise RuntimeError(f"GPU fixture missing: {cpu_fixture['id']}")
        cpu_baseline = decode_image(cpu_fixture["baseline"])
        gpu_baseline = decode_image(gpu_fixture["baseline"])
        if cpu_baseline["data"] != gpu_baseline["data"]:
            raise RuntimeError(f"CPU/GPU underpaint differs: {cpu_fixture['id']}")
        cpu_image = decode_image(cpu_fixture["rendered"])
        gpu_image = decode_image(gpu_fixture["rendered"])
        metric = calculate_parity_metrics(cpu_baseline, cpu_image, gpu_image)
        images = {
            "cpu": cpu_image,
            "gpu": gpu_image,
            "comparison": compose_comparison(cpu_image, gpu_image),
        }
        for kind, image in images.items():
            show_parity_image(client, image)
            save_screenshot(client, output_directory / f"{cpu_fixture['id']}-{kind}.png")
        fixture = {
            "id": cpu_fixture["id"],
            "sampleCount": cpu_fixture["sampleCount"],
            "moveSamples": cpu_fixture["moveSamples"],
            "samplesPerBatch": cpu_fixture["samplesPerBatch"],
            "batchCount": cpu_fixture["batchCount"],
            "cpuUndoDifferentChannels": cpu_fixture["undoDifferentChannels"],
            "gpuUndoDifferentChannels": gpu_fixture["undoDifferentChannels"],
            "metrics": metric,
        }
        fixtures.append(fixture)
        print_parity_summary(fixture)
    payload = {
        "version": 2,
        "engine": "safari-stp-mcp",
        "urls": {"cpu": cpu_url, "gpu": gpu_url},
        "rafProbes": {"cpu": cpu_probe, "gpu": gpu_probe},
        "brushSeedRandom": cpu_run["brushSeedRandom"],
        "samplesPerBatch": cpu_run["samplesPerBatch"],
        "captureSource": cpu_run["captureSource"],
        "fixtures": fixtures,
    }
    (output_directory / "metrics.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if any(not fixture["metrics"]["pass"] for fixture in fixtures):
        raise RuntimeError("one or more parity fixtures failed")


def main() -> int:
    args = parse_args()
    client_module = load_client_module()
    if not client_module.wait_http(args.base_url, 60):
        print(f"server not reachable: {args.base_url}", file=sys.stderr)
        return 1

    url = benchmark_url(
        args.base_url,
        args.gpu_backend,
        args.checkpoint_lag,
    )
    variant = f"{args.gpu_backend}-lag{args.checkpoint_lag}"
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    client = client_module.Client()
    try:
        if args.parity:
            run_parity(client, args)
            return 0
        for repeat_index in range(1, args.repeats + 1):
            probes = []
            probes.append(prepare_page(client, url))
            long_stroke = run_long_stroke(client, args.batches, args.samples)
            probes.append(prepare_page(client, url))
            undo1 = measure_undo(client, 2)
            probes.append(prepare_page(client, url))
            undo9 = measure_undo(client, 10)
            probes.append(prepare_page(client, url))
            undo_long = measure_long_undo(
                client,
                args.undo_strokes,
                args.batches,
                args.samples,
            )
            payload = {
                "engine": "safari-stp-mcp",
                "variant": variant,
                "repeat": repeat_index,
                "url": url,
                "gpuBackend": args.gpu_backend,
                "batches": args.batches,
                "samplesPerBatch": args.samples,
                "undoStrokes": args.undo_strokes,
                "checkpointLagSteps": args.checkpoint_lag,
                "rafProbes": probes,
                "longStroke": long_stroke,
                "undo1": undo1,
                "undo9": undo9,
                "undoLong": undo_long,
            }
            output_path = RESULT_DIR / f"acrylic-stp-{variant}-{repeat_index}.json"
            output_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print_summary(payload, output_path)
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"benchmark failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
