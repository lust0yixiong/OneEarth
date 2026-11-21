import test from "node:test";
import assert from "node:assert/strict";
import { randomId } from "./id";

test("uses the native UUID API where available", () => {
  const expected = crypto.randomUUID();
  assert.equal(randomId({ randomUUID: () => expected, getRandomValues: crypto.getRandomValues.bind(crypto) }), expected);
});

test("LAN HTTP without randomUUID can create distinct version 4 IDs", () => {
  const source = { getRandomValues: crypto.getRandomValues.bind(crypto) };
  const ids = Array.from({ length: 100 }, () => randomId(source));
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(ids).size, ids.length);
});
