import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { LONG_STROKE_BODY } from "./acrylic-longstroke.page.js";
const engineName = process.env.ENGINE === "chromium" ? "chromium" : "webkit";
const gpuBackend =
  process.env.GPU_DAB === "webgl2"
    ? "webgl2"
    : process.env.GPU_DAB
      ? "cpu"
      : "auto";

const baseUrl = process.env.BASE_URL ?? "https://127.0.0.1:5174";
const mixingEnabled = process.env.MIXING !== "off";
const batchCount = Number(process.env.BATCHES ?? 240);
const samplesPerBatch = Number(process.env.SAMPLES ?? 8);
const undoStrokeCount = Number(process.env.UNDO_STROKES ?? 3);
const checkpointLagSteps = Number(process.env.CHECKPOINT_LAG ?? 1);
const syncChargeEnabled = process.env.SYNC_CHARGE !== "0";
const requestedVariant = process.env.PERF_VARIANT ?? "instrumented";
const repeats = Number(process.env.REPEATS ?? "4");
const timeoutMs = Number(process.env.BENCHMARK_TIMEOUT_MS ?? "120000");
const resultDirectory = new URL("./results/", import.meta.url);
const longStrokeEvaluator = new Function(
  "element",
  "benchmarkOptions",
  LONG_STROKE_BODY.replace(
    "__BATCHES__",
    "benchmarkOptions.batchCount",
  ).replace("__SAMPLES__", "benchmarkOptions.samplesPerBatch"),
);

const variants = new Set([
  "baseline",
  "instrumented",
  "null-fullcopy",
  "null-checkpoint",
  "null-fieldadvance",
  "null-upload",
  "null-dabdraw",
  "null-render",
  "null-rotate",
]);
if (!variants.has(requestedVariant)) {
  throw new Error(`Unknown PERF_VARIANT: ${requestedVariant}`);
}
if (!Number.isInteger(repeats) || repeats < 1) {
  throw new Error(`REPEATS must be a positive integer: ${repeats}`);
}
if (!Number.isInteger(undoStrokeCount) || undoStrokeCount < 1) {
  throw new Error(
    `UNDO_STROKES must be a positive integer: ${undoStrokeCount}`,
  );
}
if (!Number.isInteger(checkpointLagSteps) || checkpointLagSteps < 1) {
  throw new Error(
    `CHECKPOINT_LAG must be a positive integer: ${checkpointLagSteps}`,
  );
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}

function summarize(values) {
  const quarter = Math.max(1, Math.floor(values.length / 4));
  return {
    p50: Number(percentile(values, 0.5).toFixed(1)),
    p95: Number(percentile(values, 0.95).toFixed(1)),
    max: Number(Math.max(0, ...values).toFixed(1)),
    earlyP50: Number(percentile(values.slice(0, quarter), 0.5).toFixed(1)),
    lateP50: Number(percentile(values.slice(-quarter), 0.5).toFixed(1)),
  };
}

function variantUrl(variant) {
  const url = new URL(baseUrl);
  if (variant !== "baseline") url.searchParams.set("perfDebug", "1");
  const nullStage = {
    "null-fullcopy": "fullcopy",
    "null-checkpoint": "checkpoint",
    "null-fieldadvance": "fieldadvance",
    "null-upload": "upload",
    "null-dabdraw": "dabdraw",
    "null-render": "render",
    "null-rotate": "rotate",
  }[variant];
  if (nullStage) url.searchParams.set("nullStages", nullStage);
  url.searchParams.set("checkpointLag", String(checkpointLagSteps));
  if (process.env.GPU_DAB) {
    url.searchParams.set(
      "gpuBackend",
      process.env.GPU_DAB === "webgl2" ? "webgl2" : "cpu",
    );
  }
  if (process.env.LAYER_SIZE)
    url.searchParams.set("layerSize", process.env.LAYER_SIZE);
  return url.href;
}

async function withTimeout(promise, label) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${label} exceeded ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

const browser = await (engineName === "chromium" ? chromium : webkit).launch({
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  ignoreHTTPSErrors: true,
});
await context.addInitScript(
  ({ enabled }) => {
    const stats = new Map();
    const record = (key, elapsed) => {
      const current = stats.get(key) ?? { count: 0, total: 0, max: 0 };
      current.count += 1;
      current.total += elapsed;
      current.max = Math.max(current.max, elapsed);
      stats.set(key, current);
    };
    if (enabled) {
      const context2d = new OffscreenCanvas(1, 1).getContext("2d");
      const prototype = Object.getPrototypeOf(context2d);
      const methods = [
        "drawImage",
        "getImageData",
        "putImageData",
        "clearRect",
      ];
      for (const name of methods) {
        const original = prototype[name];
        prototype[name] = function (...args) {
          const source = name === "drawImage" ? args[0] : undefined;
          const sourceSize =
            source && "width" in source
              ? `<-${source.width}x${source.height}`
              : "";
          const key = `${name}:${this.canvas.width}x${this.canvas.height}${sourceSize}`;
          const started = performance.now();
          try {
            return original.apply(this, args);
          } finally {
            record(key, performance.now() - started);
          }
        };
      }
    }
    window.__acrylicCanvasPerf = {
      enabled,
      reset: () => stats.clear(),
      snapshot: () => Object.fromEntries(stats),
    };
  },
  { enabled: syncChargeEnabled },
);

async function preparePage(variant) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(variantUrl(variant), { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page
    .locator("button")
    .filter({ hasText: /^Acrylic$/ })
    .click();
  if (!mixingEnabled) {
    await page.getByText("Color mixing（下地色の取り込み）").click();
  }
  const canvas = page.locator("canvas[data-headless-paint-main]");
  await canvas.waitFor();
  if (process.env.SYMMETRY) {
    const [mode, divisions] = process.env.SYMMETRY.split(":");
    await page.evaluate(
      ([m, d]) => globalThis.__hpDebugUi?.setSymmetry?.(m, Number(d)),
      [mode, divisions],
    );
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => {
    globalThis.__hpBrushPerf?.reset();
    globalThis.__hpUndoTiming?.reset();
    window.__acrylicCanvasPerf.reset();
  });
  return { page, canvas, errors };
}

async function runLongStroke(variant) {
  const { page, canvas, errors } = await preparePage(variant);
  const result = await canvas.evaluate(longStrokeEvaluator, {
    batchCount,
    samplesPerBatch,
  });
  if (process.env.SCREENSHOT_PREFIX) {
    await canvas.screenshot({ path: `${process.env.SCREENSHOT_PREFIX}.png` });
  }
  const bodyText = await page.locator("body").innerText();
  const callMetrics = Object.fromEntries(
    ["Call p50", "Call p95", "Call max"].map((label) => {
      const match = bodyText.match(new RegExp(`${label}\\s+([0-9.]+)ms`));
      return [label, match ? Number(match[1]) : null];
    }),
  );
  await page.close();
  return {
    callMetrics,
    samples: result.sampleIndex,
    dispatch: summarize(result.dispatchMs),
    frame: summarize(result.frameMs),
    scheduleLag: summarize(result.scheduleLagMs),
    drainMs: Number(result.drainMs.toFixed(3)),
    canvasPerf: Object.fromEntries(
      Object.entries(result.canvasPerf)
        .filter(([, value]) => value.count > 10 || value.total > 5)
        .sort(([, a], [, b]) => b.total - a.total)
        .map(([key, value]) => [
          key,
          {
            count: value.count,
            total: Number(value.total.toFixed(1)),
            max: Number(value.max.toFixed(1)),
          },
        ]),
    ),
    stageSnapshot: result.stageSnapshot,
    errors,
  };
}

async function dispatchUndoFixture(canvas, strokeIndex) {
  await canvas.evaluate((element, index) => {
    const rect = element.getBoundingClientRect();
    const pointerId = 1200 + index;
    const y = rect.top + rect.height * (0.25 + (index % 10) * 0.05);
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
    element.dispatchEvent(
      event("pointerdown", rect.left + rect.width * 0.3, 1),
    );
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
  }, strokeIndex);
  await canvas.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

async function measureUndo(variant, strokeCount) {
  const { page, canvas, errors } = await preparePage(variant);
  for (let index = 0; index < strokeCount; index++) {
    await dispatchUndoFixture(canvas, index);
  }
  await page.evaluate(() => globalThis.__hpUndoTiming?.reset());
  await page.getByLabel("Undo", { exact: true }).first().click();
  await page.waitForFunction(
    () => (globalThis.__hpUndoTiming?.entries.length ?? 0) > 0,
  );
  const timing = await page.evaluate(
    () => globalThis.__hpUndoTiming?.snapshot().at(-1) ?? null,
  );
  await page.close();
  return { replayedStrokes: strokeCount - 1, timing, errors };
}

async function measureLongUndo(variant) {
  const { page, canvas, errors } = await preparePage(variant);
  for (let index = 0; index < undoStrokeCount; index++) {
    await canvas.evaluate(longStrokeEvaluator, {
      batchCount,
      samplesPerBatch,
    });
  }
  await page.evaluate(() => globalThis.__hpUndoTiming?.reset());
  await page.getByLabel("Undo", { exact: true }).first().click();
  await page.waitForFunction(
    () => (globalThis.__hpUndoTiming?.entries.length ?? 0) > 0,
  );
  const timing = await page.evaluate(
    () => globalThis.__hpUndoTiming?.snapshot().at(-1) ?? null,
  );
  await page.close();
  return {
    strokes: undoStrokeCount,
    samplesPerStroke: batchCount * samplesPerBatch,
    replayedStrokes: undoStrokeCount - 1,
    timing,
    errors,
  };
}

async function runVariant(variant) {
  return {
    variant,
    longStroke: await withTimeout(runLongStroke(variant), `${variant}/stroke`),
    undo1: await withTimeout(measureUndo(variant, 2), `${variant}/undo-1`),
    undo9: await withTimeout(measureUndo(variant, 10), `${variant}/undo-9`),
    undoLong: await withTimeout(
      measureLongUndo(variant),
      `${variant}/undo-long`,
    ),
  };
}

const referenceVariant =
  requestedVariant === "baseline"
    ? "baseline"
    : requestedVariant === "instrumented"
      ? "baseline"
      : "instrumented";
const abba = [
  referenceVariant,
  requestedVariant,
  requestedVariant,
  referenceVariant,
];
const variantCounts = new Map();
const results = [];
await mkdir(resultDirectory, { recursive: true });

try {
  for (let runIndex = 0; runIndex < repeats; runIndex++) {
    const variant = abba[runIndex % abba.length];
    const variantIndex = (variantCounts.get(variant) ?? 0) + 1;
    variantCounts.set(variant, variantIndex);
    const payload = {
      engine: engineName,
      gpuBackend,
      runIndex: runIndex + 1,
      variantIndex,
      mixingEnabled,
      syncChargeEnabled,
      batches: batchCount,
      samplesPerBatch,
      undoStrokes: undoStrokeCount,
      checkpointLagSteps,
      ...(await runVariant(variant)),
    };
    const outputUrl = new URL(
      `acrylic-${engineName}-${gpuBackend}-${variant}-lag${checkpointLagSteps}-${variantIndex}.json`,
      resultDirectory,
    );
    await writeFile(outputUrl, `${JSON.stringify(payload, null, 2)}\n`);
    results.push(payload);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}

console.log(
  JSON.stringify({ requestedVariant, referenceVariant, results }, null, 2),
);
