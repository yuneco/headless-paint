import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "vite";

const resolveSource = (path: string) => new URL(path, import.meta.url).pathname;
const httpsDirectory = new URL("../../work.local/https/", import.meta.url);

function localHttpsOptions() {
  if (process.env.HP_DEV_HTTPS !== "1") return undefined;
  const keyUrl = new URL("server-key.pem", httpsDirectory);
  const certUrl = new URL("server-cert.pem", httpsDirectory);
  if (!existsSync(keyUrl) || !existsSync(certUrl)) {
    throw new Error(
      "Local HTTPS certificate is missing. Run `pnpm dev:https:setup` first.",
    );
  }
  return {
    key: readFileSync(keyUrl),
    cert: readFileSync(certUrl),
  };
}

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/headless-paint/" : "/",
  plugins: [react()],
  server: {
    https: localHttpsOptions(),
  },
  resolve: {
    alias: {
      "@headless-paint/engine": resolveSource(
        "../../packages/engine/src/index.ts",
      ),
      "@headless-paint/input": resolveSource(
        "../../packages/input/src/index.ts",
      ),
      "@headless-paint/stroke": resolveSource(
        "../../packages/stroke/src/index.ts",
      ),
      "@headless-paint/core": resolveSource("../../packages/core/src/index.ts"),
      "@headless-paint/react": resolveSource(
        "../../packages/react/src/index.ts",
      ),
    },
  },
}));
