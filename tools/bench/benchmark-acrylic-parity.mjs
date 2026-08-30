import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { ACRYLIC_PARITY_BODY } from "./acrylic-parity.page.js";

const engineName = process.env.ENGINE === "chromium" ? "chromium" : "webkit";
const baseUrl = process.env.BASE_URL ?? "https://127.0.0.1:5174";
const timeoutMs = Number(process.env.BENCHMARK_TIMEOUT_MS ?? "180000");
const symmetryName = (process.env.SYMMETRY ?? "none").replaceAll(":", "-");
const outputDirectory = new URL(
  `./results/parity-${engineName}-${symmetryName}/`,
  import.meta.url,
);
const parityEvaluator = new Function(
  "element",
  "benchmarkOptions",
  ACRYLIC_PARITY_BODY,
);

function parityUrl(backend) {
  const url = new URL(baseUrl);
  url.searchParams.set("perfDebug", "1");
  url.searchParams.set("gpuBackend", backend);
  return url.href;
}

function concise(value) {
  return Number(value.toFixed(5));
}

function decodeImage(image) {
  return {
    width: image.width,
    height: image.height,
    data: Buffer.from(image.data, "base64"),
  };
}

function changedFrom(pixels, baseline, pixelIndex) {
  const offset = pixelIndex * 4;
  return (
    Math.abs(pixels[offset] - baseline[offset]) > 1 ||
    Math.abs(pixels[offset + 1] - baseline[offset + 1]) > 1 ||
    Math.abs(pixels[offset + 2] - baseline[offset + 2]) > 1 ||
    Math.abs(pixels[offset + 3] - baseline[offset + 3]) > 1
  );
}

function bboxFor(pixels, baseline, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let coverage = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = y * width + x;
      if (!changedFrom(pixels, baseline, pixelIndex)) continue;
      coverage++;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return {
    coverage,
    bbox: coverage === 0 ? null : { left, top, right, bottom },
  };
}

function calculateMetrics(baselineImage, cpuImage, gpuImage) {
  if (
    baselineImage.width !== cpuImage.width ||
    cpuImage.width !== gpuImage.width ||
    baselineImage.height !== cpuImage.height ||
    cpuImage.height !== gpuImage.height
  ) {
    throw new Error("CPU/GPU parity image dimensions differ");
  }
  const baseline = baselineImage.data;
  const cpu = cpuImage.data;
  const gpu = gpuImage.data;
  const pixelCount = cpuImage.width * cpuImage.height;
  const cpuShape = bboxFor(cpu, baseline, cpuImage.width, cpuImage.height);
  const gpuShape = bboxFor(gpu, baseline, gpuImage.width, gpuImage.height);
  let unionCoverage = 0;
  let alphaError = 0;
  let rgbError = 0;
  let overThreshold = 0;
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    if (
      !changedFrom(cpu, baseline, pixelIndex) &&
      !changedFrom(gpu, baseline, pixelIndex)
    ) {
      continue;
    }
    unionCoverage++;
    const offset = pixelIndex * 4;
    const red = Math.abs(cpu[offset] - gpu[offset]);
    const green = Math.abs(cpu[offset + 1] - gpu[offset + 1]);
    const blue = Math.abs(cpu[offset + 2] - gpu[offset + 2]);
    const alpha = Math.abs(cpu[offset + 3] - gpu[offset + 3]);
    rgbError += red + green + blue;
    alphaError += alpha;
    if (Math.max(red, green, blue, alpha) / 255 > 0.1) overThreshold++;
  }
  const edgeDifference = {};
  let bboxEdgeMax = 0;
  if (cpuShape.bbox && gpuShape.bbox) {
    for (const edge of ["left", "top", "right", "bottom"]) {
      const difference = Math.abs(cpuShape.bbox[edge] - gpuShape.bbox[edge]);
      edgeDifference[edge] = difference;
      bboxEdgeMax = Math.max(bboxEdgeMax, difference);
    }
  } else if (cpuShape.bbox !== gpuShape.bbox) {
    bboxEdgeMax = null;
  }
  const denominator = Math.max(1, unionCoverage);
  const coverageRelativeDifference =
    Math.abs(cpuShape.coverage - gpuShape.coverage) /
    Math.max(1, cpuShape.coverage, gpuShape.coverage);
  const alphaMae = alphaError / denominator / 255;
  const rgbMae = rgbError / denominator / 3 / 255;
  const overPointOneRate = overThreshold / denominator;
  return {
    source: "display-canvas-roi",
    width: cpuImage.width,
    height: cpuImage.height,
    cpuCoverage: cpuShape.coverage,
    gpuCoverage: gpuShape.coverage,
    unionCoverage,
    coverageRelativeDifference,
    alphaMae,
    rgbMae,
    overPointOneRate,
    cpuBbox: cpuShape.bbox,
    gpuBbox: gpuShape.bbox,
    bboxEdgeDifference: edgeDifference,
    bboxEdgeMax,
    thresholds: {
      alphaMae: 0.015,
      rgbMae: 0.02,
      overPointOneRate: 0.01,
      bboxEdgeMax: 1,
    },
    pass:
      unionCoverage > 0 &&
      alphaMae <= 0.015 &&
      rgbMae <= 0.02 &&
      overPointOneRate <= 0.01 &&
      bboxEdgeMax !== null &&
      bboxEdgeMax <= 1,
  };
}

function composeComparison(cpu, gpu) {
  const width = cpu.width * 3;
  const data = Buffer.alloc(width * cpu.height * 4);
  for (let y = 0; y < cpu.height; y++) {
    for (let x = 0; x < cpu.width; x++) {
      const sourceOffset = (y * cpu.width + x) * 4;
      for (let panel = 0; panel < 3; panel++) {
        const targetOffset = (y * width + x + panel * cpu.width) * 4;
        if (panel === 0) {
          cpu.data.copy(data, targetOffset, sourceOffset, sourceOffset + 4);
        } else if (panel === 1) {
          gpu.data.copy(data, targetOffset, sourceOffset, sourceOffset + 4);
        } else {
          data[targetOffset] = Math.min(
            255,
            Math.abs(cpu.data[sourceOffset] - gpu.data[sourceOffset]) * 4,
          );
          data[targetOffset + 1] = Math.min(
            255,
            Math.abs(cpu.data[sourceOffset + 1] - gpu.data[sourceOffset + 1]) *
              4,
          );
          data[targetOffset + 2] = Math.min(
            255,
            Math.abs(cpu.data[sourceOffset + 2] - gpu.data[sourceOffset + 2]) *
              4,
          );
          data[targetOffset + 3] = 255;
        }
      }
    }
  }
  return { width, height: cpu.height, data };
}

async function renderBackend(context, backend) {
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const url = parityUrl(backend);
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    const canvas = page.locator("canvas[data-headless-paint-main]");
    await canvas.waitFor();
    await page.waitForFunction(() => Boolean(globalThis.__hpDebugUi));
    if (process.env.SYMMETRY) {
      const [mode, divisions] = process.env.SYMMETRY.split(":");
      await page.evaluate(
        ([nextMode, nextDivisions]) =>
          globalThis.__hpDebugUi?.setSymmetry?.(
            nextMode,
            Number(nextDivisions),
          ),
        [mode, divisions],
      );
      await page.waitForTimeout(200);
    }
    const result = await canvas.evaluate(parityEvaluator, { backend });
    return { url, result, errors };
  } finally {
    await page.close();
  }
}

async function saveRgba(page, image, outputUrl) {
  const base64 = image.data.toString("base64");
  await page.evaluate(
    ({ width, height, data }) => {
      document.body.replaceChildren();
      document.body.style.margin = "0";
      const binary = atob(data);
      const pixels = new Uint8ClampedArray(binary.length);
      for (let index = 0; index < binary.length; index++) {
        pixels[index] = binary.charCodeAt(index);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas
        .getContext("2d")
        .putImageData(new ImageData(pixels, width, height), 0, 0);
      document.body.append(canvas);
    },
    { width: image.width, height: image.height, data: base64 },
  );
  await page.locator("canvas").screenshot({ path: fileURLToPath(outputUrl) });
}

await mkdir(outputDirectory, { recursive: true });
const browser = await (engineName === "chromium" ? chromium : webkit).launch({
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  ignoreHTTPSErrors: true,
  deviceScaleFactor: 1,
});

try {
  const cpuRun = await renderBackend(context, "cpu");
  const gpuRun = await renderBackend(context, "webgl2");
  const gpuById = new Map(
    gpuRun.result.fixtures.map((fixture) => [fixture.id, fixture]),
  );
  const artifactPage = await context.newPage();
  const fixtures = [];
  try {
    for (const cpuFixture of cpuRun.result.fixtures) {
      const gpuFixture = gpuById.get(cpuFixture.id);
      if (!gpuFixture) throw new Error(`GPU fixture missing: ${cpuFixture.id}`);
      const cpuBaseline = decodeImage(cpuFixture.baseline);
      const gpuBaseline = decodeImage(gpuFixture.baseline);
      if (!cpuBaseline.data.equals(gpuBaseline.data)) {
        throw new Error(`CPU/GPU underpaint differs: ${cpuFixture.id}`);
      }
      const cpu = decodeImage(cpuFixture.rendered);
      const gpu = decodeImage(gpuFixture.rendered);
      const metrics = calculateMetrics(cpuBaseline, cpu, gpu);
      const comparison = composeComparison(cpu, gpu);
      await saveRgba(
        artifactPage,
        cpu,
        new URL(`${cpuFixture.id}-cpu.png`, outputDirectory),
      );
      await saveRgba(
        artifactPage,
        gpu,
        new URL(`${cpuFixture.id}-gpu.png`, outputDirectory),
      );
      await saveRgba(
        artifactPage,
        comparison,
        new URL(`${cpuFixture.id}-comparison.png`, outputDirectory),
      );
      fixtures.push({
        id: cpuFixture.id,
        sampleCount: cpuFixture.sampleCount,
        moveSamples: cpuFixture.moveSamples,
        samplesPerBatch: cpuFixture.samplesPerBatch,
        batchCount: cpuFixture.batchCount,
        cpuUndoDifferentChannels: cpuFixture.undoDifferentChannels,
        gpuUndoDifferentChannels: gpuFixture.undoDifferentChannels,
        metrics,
      });
    }
  } finally {
    await artifactPage.close();
  }

  const errors = [...cpuRun.errors, ...gpuRun.errors];
  const payload = {
    version: 2,
    engine: engineName,
    symmetry: process.env.SYMMETRY ?? null,
    urls: { cpu: cpuRun.url, gpu: gpuRun.url },
    brushSeedRandom: cpuRun.result.brushSeedRandom,
    samplesPerBatch: cpuRun.result.samplesPerBatch,
    captureSource: cpuRun.result.captureSource,
    fixtures,
    errors,
  };
  await writeFile(
    new URL("metrics.json", outputDirectory),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
  for (const fixture of fixtures) {
    const metric = fixture.metrics;
    console.log(
      [
        fixture.id,
        `coverage=${concise(metric.coverageRelativeDifference)}`,
        `alphaMAE=${concise(metric.alphaMae)}`,
        `rgbMAE=${concise(metric.rgbMae)}`,
        `delta>0.1=${concise(metric.overPointOneRate)}`,
        `bbox=${metric.bboxEdgeMax ?? "null"}px`,
        `pass=${metric.pass}`,
        `undo=${fixture.cpuUndoDifferentChannels}/${fixture.gpuUndoDifferentChannels}`,
      ].join(" "),
    );
  }
  if (errors.length > 0 || fixtures.some((fixture) => !fixture.metrics.pass)) {
    if (errors.length > 0) {
      console.error(`captured ${errors.length} page error(s)`);
    }
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
