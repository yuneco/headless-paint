import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [
        "@headless-paint/engine",
        "@headless-paint/input",
        "@headless-paint/stroke",
      ],
    },
  },
  plugins: [dts({ rollupTypes: true })],
});
