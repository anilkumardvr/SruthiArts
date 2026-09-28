import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The shop is served from a sub-path on GitHub Pages (/SruthiArts/) and from the root on www.sruthiarts.com,
// so every built URL is relative. site/ is the public dir: admin/, images/, favicon.svg, 404.html and
// data/shop.json (built by scripts/build-data.mjs) are served in dev and copied into dist/ as-is.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  publicDir: path.resolve(import.meta.dirname, "../site"),
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: { outDir: "dist", emptyOutDir: true, assetsDir: "assets/app" },
});
