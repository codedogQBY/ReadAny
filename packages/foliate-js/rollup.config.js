import { nodeResolve } from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";

export default [
  {
    input: "rollup/fflate.js",
    output: {
      dir: "vendor/",
      format: "esm",
    },
    plugins: [nodeResolve(), terser()],
  },
  {
    input: "rollup/zip.js",
    output: {
      dir: "vendor/",
      format: "esm",
    },
    plugins: [nodeResolve(), terser()],
  },
];
