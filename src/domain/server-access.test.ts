import test from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { accessGuard } from "../../server/access";

function allowed(host: string, origin?: string, configured = "") {
  let passed = false;
  let status = 0;
  const req = { protocol: "http", get: (name: string) => name === "host" ? host : name === "origin" ? origin : undefined } as Request;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as Response;
  accessGuard(configured)(req, res, () => { passed = true; });
  return { passed, status };
}

test("local access and SSH tunnels remain available by default", () => {
  for (const host of ["localhost:5174", "127.0.0.1:5175", "[::1]:5174"]) assert.equal(allowed(host, "http://" + host).passed, true);
  assert.equal(allowed("192.0.2.143:5174").status, 403);
});

test("LAN access permits only configured hosts, with the matching browser origin", () => {
  const config = "192.0.2.143, Workbench.Example";
  for (const host of ["192.0.2.143:5174", "workbench.example:5174"]) {
    assert.equal(allowed(host, "http://" + host, config).passed, true);
    assert.equal(allowed(host, undefined, config).passed, true);
    for (const origin of ["http://evil.example", "null", "http://192.0.2.143:9999"]) assert.equal(allowed(host, origin, config).status, 403);
  }
  assert.equal(allowed("192.0.2.143.evil.example:5174", undefined, config).status, 403);
  assert.equal(allowed("192.0.2.144:5174", undefined, config).status, 403);
});

test("malformed hosts and wildcard configuration are rejected", () => {
  for (const host of ["", "localhost@evil.example", "localhost/path", "localhost:5174.evil", "localhost:99999", "localhost:5174#ignored", "localhost?ignored"]) assert.equal(allowed(host).status, 403);
  for (const config of ["*", "http://192.0.2.143", "192.0.2.143:5174", "*.example.com"]) assert.throws(() => accessGuard(config), /ONEEARTH_ALLOWED_HOSTS/);
});
