import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import { Socket } from "node:net";
import { brotliCompressSync, gzipSync, brotliDecompressSync, gunzipSync } from "node:zlib";
import express from "express";
import { staticAssets } from "../../server/static-assets";

// Exercise the real Express/static file path without opening a network listener.
async function request(directory: string, url: string, encoding?: string, method = "GET") {
  const chunks: Buffer[] = [];
  const wire = new Duplex({read() {}, write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); }});
  const req = new IncomingMessage(wire as Socket);
  req.method = method;
  req.url = url;
  req.headers = {host: "localhost", ...(encoding ? {"accept-encoding": encoding} : {})};
  const res = new ServerResponse(req);
  res.assignSocket(wire as Socket);
  const app = express();
  app.use("/assets", staticAssets(directory));
  app.use((_req, reply) => { reply.sendStatus(404); });
  await new Promise<void>((resolve, reject) => {
    res.once("finish", resolve);
    res.once("error", reject);
    app(req, res);
  });
  const bytes = Buffer.concat(chunks);
  wire.destroy();
  return { status: res.statusCode, headers: res.getHeaders(), body: bytes.subarray(bytes.indexOf("\r\n\r\n") + 4) };
}

test("production assets negotiate compression, preserve MIME/cache headers, and fall back safely", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "oneearth-assets-"));
  const js = Buffer.from("export const globe = 'ready';\n".repeat(100));
  const css = Buffer.from("canvas { display: block; }\n".repeat(100));
  try {
    for (const [name, bytes] of [["app-hash.js", js], ["globe-hash.css", css]] as const) {
      writeFileSync(path.join(dir, name), bytes);
      writeFileSync(path.join(dir, name + ".br"), brotliCompressSync(bytes));
      writeFileSync(path.join(dir, name + ".gz"), gzipSync(bytes));
    }
    const br = await request(dir, "/assets/app-hash.js?v=1", "br, gzip");
    assert.equal(br.status, 200);
    assert.equal(br.headers["content-encoding"], "br");
    assert.match(String(br.headers["content-type"]), /javascript/);
    assert.match(String(br.headers["cache-control"]), /max-age=31536000.*immutable/);
    assert.match(String(br.headers.vary), /Accept-Encoding/);
    assert.deepEqual(brotliDecompressSync(br.body), js);
    const gz = await request(dir, "/assets/globe-hash.css", "br;q=0, gzip");
    assert.equal(gz.headers["content-encoding"], "gzip");
    assert.match(String(gz.headers["content-type"]), /text\/css/);
    assert.deepEqual(gunzipSync(gz.body), css);
    const plain = await request(dir, "/assets/app-hash.js", "br;q=0,gzip;q=0");
    assert.equal(plain.headers["content-encoding"], undefined);
    assert.deepEqual(plain.body, js);
    const absentHeader = await request(dir, "/assets/app-hash.js");
    assert.equal(absentHeader.headers["content-encoding"], undefined);
    assert.deepEqual(absentHeader.body, js);
    const head = await request(dir, "/assets/app-hash.js", "br", "HEAD");
    assert.equal(head.headers["content-encoding"], "br");
    assert.equal(head.body.length, 0);
    writeFileSync(path.join(dir, "old.js"), js);
    const old = await request(dir, "/assets/old.js", "br");
    assert.equal(old.status, 200);
    assert.equal(old.headers["content-encoding"], undefined);
    assert.deepEqual(old.body, js);
    const missing = await request(dir, "/assets/missing.js", "br");
    assert.equal(missing.status, 404);
    assert.equal(missing.headers["content-encoding"], undefined);
    assert.equal((await request(dir, "/assets/%2e%2e/package.json", "br")).status, 404);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
