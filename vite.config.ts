import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react(), {
    name: "pdf-reader-resources",
    generateBundle() {
      for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
        const directory = fileURLToPath(new URL("./node_modules/pdfjs-dist/" + folder + "/", import.meta.url));
        for (const file of readdirSync(directory)) {
          this.emitFile({type:"asset",fileName:"pdf-resources/"+folder+"/"+file,source:readFileSync(join(directory,file))});
        }
      }
    }
  }],
  build: { chunkSizeWarningLimit: 1100, outDir: process.env.ONEEARTH_DIST_DIR || "dist" },
  server: { host: "127.0.0.1" },
});
