import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  resolve: {
    alias: {
      "@headless-paint/core": resolve(__dirname, "../core/src/index.ts"),
      "@headless-paint/react": resolve(__dirname, "../react/src/index.ts"),
      "@headless-paint/engine": resolve(__dirname, "../engine/src/index.ts"),
      "@headless-paint/input": resolve(__dirname, "../input/src/index.ts"),
      "@headless-paint/stroke": resolve(__dirname, "../stroke/src/index.ts"),
    },
  },
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        core: resolve(__dirname, "src/core.ts"),
        react: resolve(__dirname, "src/react.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ["react", "react/jsx-runtime"],
    },
  },
  plugins: [
    dts({
      include: ["src/**/*"],
    }),
  ],
});
