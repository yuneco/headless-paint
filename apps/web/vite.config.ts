import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@headless-paint/engine": resolve(__dirname, "../../packages/engine/src/index.ts"),
      "@headless-paint/input": resolve(__dirname, "../../packages/input/src/index.ts"),
      "@headless-paint/stroke": resolve(__dirname, "../../packages/stroke/src/index.ts"),
    },
  },
});
