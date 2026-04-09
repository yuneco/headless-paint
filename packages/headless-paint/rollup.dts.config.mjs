import { dts } from "rollup-plugin-dts";

const entryNames = ["index", "core", "react"];
const external = (id) =>
  id === "react" || id === "react/jsx-runtime" || id === "gl-matrix";

export default entryNames.map((entryName) => ({
  input: `types/${entryName}.d.ts`,
  output: {
    file: `dist/${entryName}.d.ts`,
    format: "es",
  },
  external,
  plugins: [dts({ respectExternal: true })],
}));
