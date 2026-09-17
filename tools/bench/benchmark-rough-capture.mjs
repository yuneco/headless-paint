import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
const engineName = process.env.ENGINE === "chromium" ? "chromium" : "webkit";

const processStartedAt = performance.now();
const baseUrl = process.env.BASE_URL ?? "https://127.0.0.1:5174";
const requestedMode = process.argv[2] ?? "endpoints";
const acceptedPointLimit = Number(process.argv[3] ?? "0");
const timeoutMs = Number(process.env.BENCHMARK_TIMEOUT_MS ?? "60000");
const requestedVariant = process.env.PERF_VARIANT ?? "instrumented";
const repeats = Number(process.env.REPEATS ?? "4");
const resultDirectory = new URL("./results/", import.meta.url);
const fixture = JSON.parse(
  await readFile(new URL("./fixtures-rough-comb06-input.json", import.meta.url), "utf8"),
);

const variants = new Set([
  "baseline",
  "instrumented",
  "null-field",
  "null-contact",
  "null-raster",
  "null-drawsweep",
  "null-render",
]);
if (!variants.has(requestedVariant)) {
  throw new Error(`Unknown PERF_VARIANT: ${requestedVariant}`);
}
if (!Number.isInteger(repeats) || repeats < 1) {
  throw new Error(`REPEATS must be a positive integer: ${repeats}`);
}
if (!["endpoints", "all-accepted", "both"].includes(requestedMode)) {
  throw new Error(`Unknown mode argv: ${requestedMode}`);
}

function progress(event, details = {}) {
  console.log(
    JSON.stringify({
      event,
      processElapsedMs: Number((performance.now() - processStartedAt).toFixed(1)),
      ...details,
    }),
  );
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  ];
}

function summarize(values) {
  return {
    p50: Number(percentile(values, 0.5).toFixed(1)),
    p95: Number(percentile(values, 0.95).toFixed(1)),
    max: Number(Math.max(0, ...values).toFixed(1)),
  };
}

function variantUrl(variant) {
  const url = new URL(baseUrl);
  if (variant !== "baseline") url.searchParams.set("perfDebug", "1");
  if (process.env.GPU_BACKEND) url.searchParams.set("gpuBackend", process.env.GPU_BACKEND);
  if (process.env.FUSED_INK === "1") url.searchParams.set("fusedInk", "1");
  const nullStage = {
    "null-field": "field",
    "null-contact": "contact",
    "null-raster": "raster",
    "null-drawsweep": "drawsweep",
    "null-render": "render",
  }[variant];
  if (nullStage) url.searchParams.set("nullStages", nullStage);
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

const browser = await (engineName === "chromium" ? chromium : webkit).launch({ headless: true });

async function preparePage(variant) {
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
    ignoreHTTPSErrors: true,
  });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.text().startsWith("[rough-capture]")) {
      progress("page-progress", { variant, message: message.text() });
    }
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(variantUrl(variant), { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("button").filter({ hasText: /^Rough bristle$/ }).click();
  const lineWidthInput = page
    .getByText("Line Width", { exact: true })
    .locator("..")
    .locator("input");
  await lineWidthInput.fill("60");
  await lineWidthInput.press("Enter");
  await page
    .locator("button")
    .filter({ hasText: /^Material brush evaluation$/ })
    .click();
  await page.getByRole("button", { name: "Reset metrics" }).click();
  const canvas = page.locator("canvas[data-headless-paint-main]");
  await canvas.waitFor();
  await page.evaluate(() => {
    globalThis.__hpBrushPerf?.reset();
    globalThis.__hpUndoTiming?.reset();
  });
  return { page, canvas, errors };
}

async function replayCapture(canvas, mode) {
  return canvas.evaluate(
    async (element, payload) => {
      const {
        fixture: inputFixture,
        mode: replayMode,
        acceptedPointLimit: pointLimit,
      } = payload;
      const rect = element.getBoundingClientRect();
      const allBatches = inputFixture.input.batches;
      const points = inputFixture.input.points;
      const batches =
        replayMode === "all-accepted" && pointLimit > 0
          ? allBatches.filter((batch) => batch.startPointIndex < pointLimit)
          : allBatches;
      const firstTimestamp = points[0]?.timestamp ?? 0;
      const selectedPointCount =
        replayMode === "all-accepted" && pointLimit > 0
          ? Math.min(pointLimit, points.length)
          : points.length;
      const lastSelectedTimestamp =
        points[Math.max(0, selectedPointCount - 1)]?.timestamp ?? firstTimestamp;
      const pointerId = 606;
      const batchDurations = [];
      const deliveryLateness = [];
      let dispatchedSamples = 0;
      element.setPointerCapture = () => {};
      element.releasePointerCapture = () => {};
      element.hasPointerCapture = () => false;

      const createPointerEvent = (type, point, buttons) => {
        const event = new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + point.x,
          clientY: rect.top + point.y,
          pointerId,
          pointerType: "pen",
          pressure: point.pressure,
          buttons,
        });
        Object.defineProperty(event, "timeStamp", {
          configurable: true,
          value: point.timestamp,
        });
        return event;
      };

      const dispatch = (type, point, buttons, coalescedPoints = []) => {
        const event = createPointerEvent(type, point, buttons);
        if (type === "pointermove") {
          const samples = coalescedPoints.map((sample) =>
            createPointerEvent("pointermove", sample, buttons),
          );
          Object.defineProperty(event, "getCoalescedEvents", {
            configurable: true,
            value: () => samples,
          });
        }
        element.dispatchEvent(event);
        dispatchedSamples += Math.max(1, coalescedPoints.length);
      };

      const startedAt = performance.now();
      await new Promise((resolve) => {
        let remaining = batches.length;
        for (const [batchIndex, batch] of batches.entries()) {
          const native = batch.nativePoint;
          const targetDelay = Math.max(
            0,
            (native?.timestamp ?? firstTimestamp) - firstTimestamp,
          );
          setTimeout(() => {
            const batchStarted = performance.now();
            deliveryLateness.push(batchStarted - startedAt - targetDelay);
            if (replayMode === "endpoints") {
              if (batch.phase === "down") {
                dispatch("pointerdown", native, 1);
              } else if (batch.phase === "move") {
                dispatch("pointermove", native, 1, batch.samples ?? []);
              } else {
                dispatch("pointerup", native, 0);
              }
            } else {
              const accepted = points.slice(
                batch.startPointIndex,
                pointLimit > 0
                  ? Math.min(batch.endPointIndex, pointLimit)
                  : batch.endPointIndex,
              );
              for (const [sampleIndex, point] of accepted.entries()) {
                const isFirst = batchIndex === 0 && sampleIndex === 0;
                dispatch(isFirst ? "pointerdown" : "pointermove", point, 1);
              }
              if (batchIndex === batches.length - 1) {
                dispatch("pointerup", accepted.at(-1) ?? native, 0);
              }
            }
            batchDurations.push(performance.now() - batchStarted);
            remaining--;
            if (remaining === 0) resolve();
          }, targetDelay);
        }
      });
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const drainStartedAt = performance.now();
      element.getContext("2d")?.getImageData(0, 0, 1, 1);
      const drainMs = performance.now() - drainStartedAt;
      return {
        dispatchedSamples,
        elapsedMs: performance.now() - startedAt,
        sourceDurationMs: lastSelectedTimestamp - firstTimestamp,
        batchDurations,
        deliveryLateness,
        drainMs,
        stageSnapshot: globalThis.__hpBrushPerf?.snapshot() ?? null,
      };
    },
    { fixture, mode, acceptedPointLimit },
  );
}

async function runMode(variant, mode) {
  const { page, canvas, errors } = await preparePage(variant);
  const replay = await replayCapture(canvas, mode);
  if (process.env.SCREENSHOT_PREFIX) {
    await canvas.screenshot({ path: `${process.env.SCREENSHOT_PREFIX}-${mode}.png` });
  }
  const bodyText = await page.locator("body").innerText();
  const callMetrics = Object.fromEntries(
    ["Call p50", "Call p95", "Call max"].map((label) => {
      const match = bodyText.match(new RegExp(`${label}\\s+([0-9.]+)ms`));
      return [label, match ? Number(match[1]) : null];
    }),
  );
  const acceptedMatch = bodyText.match(/([0-9]+) samples。入力callback内/);
  await page.close();
  return {
    mode,
    dispatchedSamples: replay.dispatchedSamples,
    measuredEngineCalls: acceptedMatch ? Number(acceptedMatch[1]) : null,
    sourceDurationMs: replay.sourceDurationMs,
    elapsedMs: Number(replay.elapsedMs.toFixed(1)),
    batchWall: summarize(replay.batchDurations),
    batchDurationsRaw: replay.batchDurations.map((v) => Number(v.toFixed(2))),
    deliveryLateness: summarize(replay.deliveryLateness),
    drainMs: Number(replay.drainMs.toFixed(3)),
    callMetrics,
    stageSnapshot: replay.stageSnapshot,
    errors,
  };
}

async function dispatchUndoFixture(canvas, strokeIndex) {
  await canvas.evaluate((element, index) => {
    const rect = element.getBoundingClientRect();
    const pointerId = 900 + index;
    const y = rect.top + rect.height * (0.25 + (index % 10) * 0.05);
    const makeEvent = (type, x, buttons, pressure = 0.62) =>
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
      makeEvent("pointerdown", rect.left + rect.width * 0.3, 1),
    );
    for (let step = 1; step <= 8; step++) {
      const event = makeEvent(
        "pointermove",
        rect.left + rect.width * (0.3 + step * 0.045),
        1,
      );
      Object.defineProperty(event, "getCoalescedEvents", { value: () => [] });
      element.dispatchEvent(event);
    }
    element.dispatchEvent(
      makeEvent("pointerup", rect.left + rect.width * 0.66, 0, 0),
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

async function runVariant(variant) {
  const modes =
    requestedMode === "both" ? ["endpoints", "all-accepted"] : [requestedMode];
  const modeResults = [];
  for (const mode of modes) {
    modeResults.push(await withTimeout(runMode(variant, mode), `${variant}/${mode}`));
  }
  const undo1 = await withTimeout(measureUndo(variant, 2), `${variant}/undo-1`);
  const undo9 = await withTimeout(measureUndo(variant, 10), `${variant}/undo-9`);
  return { variant, modeResults, undo1, undo9 };
}

const referenceVariant =
  requestedVariant === "baseline"
    ? "baseline"
    : requestedVariant === "instrumented"
      ? "baseline"
      : "instrumented";
const abba = [referenceVariant, requestedVariant, requestedVariant, referenceVariant];
const variantCounts = new Map();
const results = [];
await mkdir(resultDirectory, { recursive: true });

progress("process-start", {
  baseUrl,
  requestedMode,
  acceptedPointLimit,
  requestedVariant,
  referenceVariant,
  repeats,
});

try {
  for (let runIndex = 0; runIndex < repeats; runIndex++) {
    const variant = abba[runIndex % abba.length];
    const variantIndex = (variantCounts.get(variant) ?? 0) + 1;
    variantCounts.set(variant, variantIndex);
    progress("run-start", { runIndex: runIndex + 1, variant, variantIndex });
    const result = await runVariant(variant);
    const payload = {
      engine: engineName,
      runIndex: runIndex + 1,
      variantIndex,
      fixture: {
        points: fixture.input.points.length,
        batches: fixture.input.batches.length,
        coalescedSamples: fixture.input.coalescedSamples,
      },
      acceptedPointLimit,
      ...result,
    };
    const outputUrl = new URL(`rough-${engineName}-${variant}-${variantIndex}.json`, resultDirectory);
    await writeFile(outputUrl, `${JSON.stringify(payload, null, 2)}\n`);
    results.push(payload);
    progress("run-end", { runIndex: runIndex + 1, variant, variantIndex });
  }
} catch (error) {
  progress("benchmark-error", { error: String(error) });
  process.exitCode = 1;
} finally {
  await browser.close();
}

console.log(JSON.stringify({ requestedVariant, referenceVariant, results }, null, 2));
progress("process-end", { exitCode: process.exitCode ?? 0 });
