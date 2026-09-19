import { createRequire } from "node:module";
const { createServer } = await import(
  createRequire(
    new URL("../../apps/web/package.json", import.meta.url),
  ).resolve("vite")
);
import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
const out = resolve(process.argv[2] ?? "work.local/bristle-coverage/current");
await mkdir(out, { recursive: true });
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  resolve: {
    alias: Object.fromEntries(
      ["engine", "input", "stroke"].map((x) => [
        `@headless-paint/${x}`,
        resolve(`packages/${x}/src/index.ts`),
      ]),
    ),
  },
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  const metadata = await page.evaluate(() => {
    const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      renderer: info
        ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
        : "unknown",
    };
  });
  await writeFile(`${out}/environment.json`, JSON.stringify(metadata, null, 2));
  const results = await page.evaluate(async () => {
    const { measure } = await import("/tools/bench/bristle-coverage.page.ts");
    return measure();
  });
  for (const r of results) {
    const name = `${r.backend}-${r.kind}-${r.substrate ? "color" : "blank"}-${r.mixing ? "on" : "off"}`;
    await writeFile(`${out}/${name}.png`, Buffer.from(r.png, "base64"));
    delete r.png;
  }
  await writeFile(`${out}/results.json`, JSON.stringify(results));
  console.log(`Saved ${results.length} cases to ${out}`);
} finally {
  await browser.close();
  await server.close();
}
