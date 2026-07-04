import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
const pdfjsDist = path.resolve(__dirname, "../../node_modules/pdfjs-dist");

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "pdfjs-dist/build/pdf.worker.mjs": path.join(pdfjsDist, "build/pdf.worker.mjs"),
      "pdfjs-dist": pdfjsDist,
      // Map @pdfjs/* to foliate-js vendored pdfjs (v4.7, compatible with foliate-js)
      "@pdfjs": path.resolve(__dirname, "../../foliate-js/vendor/pdfjs"),
    },
    dedupe: ["i18next", "react-i18next", "react", "react-dom"],
  },
  optimizeDeps: {
    // Exclude foliate-js pdf.js from pre-bundling so that @pdfjs alias works
    exclude: ["foliate-js/pdf.js"],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
