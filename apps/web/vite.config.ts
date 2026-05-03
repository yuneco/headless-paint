import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const resolveSource = (path: string) => new URL(path, import.meta.url).pathname;

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/headless-paint/" : "/",
  plugins: [react()],
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
