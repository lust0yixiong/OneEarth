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
  }, {
    name: "cesium-proof-resources",
    apply: "build",
    generateBundle() {
      if (process.env.VITE_ONEEARTH_CESIUM_PROOF !== "1" && process.env.VITE_ONEEARTH_CESIUM_STRICT !== "1") return;
      const root = fileURLToPath(new URL("./node_modules/cesium/Build/Cesium/", import.meta.url));
      const emit = (directory: string) => {
        for (const item of readdirSync(join(root, directory), {withFileTypes:true})) {
          const path = directory + "/" + item.name;
          if (item.isDirectory()) emit(path);
          else this.emitFile({type:"asset",fileName:"cesium/" + path,source:readFileSync(join(root,path))});
        }
      };
      for (const directory of ["Assets","Workers","ThirdParty"]) emit(directory);
    }
  }],
  build: { chunkSizeWarningLimit: 1100, outDir: process.env.ONEEARTH_DIST_DIR || "dist" },
  server: { host: "127.0.0.1" },
});
