import { readdir, readFile, writeFile } from "node:fs/promises";
import {pathToFileURL} from 'node:url';
import { promisify } from "node:util";
import { brotliCompress, gzip, constants } from "node:zlib";

const compressBr = promisify(brotliCompress), compressGzip = promisify(gzip);
const directory = process.env.ONEEARTH_DIST_DIR?pathToFileURL(process.env.ONEEARTH_DIST_DIR.replace(/\/$/,'')+'/assets/'):new URL("../dist/assets/", import.meta.url);
let original = 0, compressed = 0;
await Promise.all((await readdir(directory)).filter(name => /\.(js|css)$/.test(name)).map(async name => {
  const file = new URL(name, directory), bytes = await readFile(file);
  const [br, gz] = await Promise.all([
    compressBr(bytes, {params: {[constants.BROTLI_PARAM_QUALITY]: 9}}),
    compressGzip(bytes, {level: 9}),
  ]);
  await Promise.all([writeFile(new URL(name + ".br", directory), br), writeFile(new URL(name + ".gz", directory), gz)]);
  original += bytes.length;
  compressed += br.length;
}));
console.log(`Static assets: ${(original / 1024).toFixed(0)} KiB → ${(compressed / 1024).toFixed(0)} KiB Brotli (${(100 * (1 - compressed / original)).toFixed(0)}% smaller).`);
