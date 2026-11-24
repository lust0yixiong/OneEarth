import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {resultBatchCandidates} from "./browser-turn-frame";
import {assets} from "./datasets";
import type {ResultBatch} from "./turn-context";

test("visible data cards are a subset of the original execution batch", () => {
  const [first, second, unrelated] = assets.slice(0,3).map(asset=>asset.id);
  const page = "web:https://example.invalid/report";
  const batch: ResultBatch = {batchId:randomUUID(),taskId:randomUUID(),turnId:randomUUID(),conversationId:randomUUID(),
    kind:"research",status:"complete",query:"Find recent data",channels:[],itemIds:[first,second,page]};
  assert.deepEqual(resultBatchCandidates(batch,[unrelated,second,page]),[second]);
  assert.deepEqual(resultBatchCandidates(batch),[first,second]);
  assert.deepEqual(resultBatchCandidates({...batch,itemIds:[page]}),[]);
  assert.deepEqual(batch.itemIds,[first,second,page]);
});
