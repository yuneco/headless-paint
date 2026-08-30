import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";

const engineName = process.env.ENGINE ?? "webkit";
const benchmarkUrl =
  process.env.BRIDGE_BENCH_URL ??
  "http://127.0.0.1:5183/tools/bench/bridge-bench/index.html";
const timeoutMs = Number(process.env.BENCHMARK_TIMEOUT_MS ?? "900000");
const htmlUrl = new URL("./bridge-bench/index.html", import.meta.url);
const resultDirectory = new URL("./results/", import.meta.url);
const resultUrl = new URL(`bridge-${engineName}.json`, resultDirectory);

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error(`BENCHMARK_TIMEOUT_MS must be positive: ${timeoutMs}`);
}
if (!new Set(["webkit", "chromium"]).has(engineName)) {
  throw new Error(`ENGINE must be webkit or chromium: ${engineName}`);
}

function printWarmP95Table(results, mode) {
  const sizes = [...new Set(results.map((row) => row.size))];
  const rows = results.filter((row) => row.mode === mode);
  console.log(`\n${mode} warm p95 (ms)`);
  console.log(["backend", "source", ...sizes].join("\t"));
  for (const backend of ["webgl2", "webgpu"]) {
    for (const source of [
      "direct",
      "transferToImageBitmap",
      "createImageBitmap",
      "canvas2d-control",
    ]) {
      const values = sizes.map((size) => {
        const row = rows.find(
          (candidate) =>
            candidate.backend === backend &&
            candidate.source === source &&
            candidate.size === size,
        );
        if (!row || row.warmP95 === null) return "skip";
        return String(row.warmP95);
      });
      console.log([backend, source, ...values].join("\t"));
    }
  }
}

const browserType = engineName === "chromium" ? chromium : webkit;
const browser = await browserType.launch({ headless: true });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(10_000);
  page.on("console", (message) => {
    if (message.text().startsWith("[bridge-bench]")) {
      console.log(message.text());
    }
  });
  page.on("pageerror", (error) => {
    console.error(`[pageerror] ${error}`);
  });

  let useInjectedHtml = false;
  try {
    const response = await page.goto(benchmarkUrl, { waitUntil: "domcontentloaded" });
    useInjectedHtml = !response?.ok() || !(await page.locator("#result").count());
  } catch (error) {
    console.warn(`[bridge-bench] dev server unavailable: ${error.message}`);
    useInjectedHtml = true;
  }

  if (useInjectedHtml) {
    const html = await readFile(htmlUrl, "utf8");
    await page.route(benchmarkUrl, async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html", body: html });
    });
    await page.goto(benchmarkUrl, { waitUntil: "domcontentloaded" });
    console.log("[bridge-bench] loaded HTML through Playwright route");
  }

  await page.waitForFunction(
    () => globalThis.__bridgeDone === true,
    undefined,
    { timeout: timeoutMs },
  );
  const result = await page.evaluate(() => globalThis.__bridgeResult);
  if (!result || !Array.isArray(result.results)) {
    throw new Error("Page returned an invalid bridge benchmark result");
  }

  result.runner = {
    engine: engineName,
    benchmarkUrl,
    capturedAt: new Date().toISOString(),
  };
  await mkdir(resultDirectory, { recursive: true });
  await writeFile(resultUrl, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`\nSaved ${result.results.length} rows to ${resultUrl.pathname}`);
  printWarmP95Table(result.results, "sync");
  printWarmP95Table(result.results, "production-like");
} finally {
  await page?.close();
  await browser.close();
}
