import assert from "node:assert/strict";
import test from "node:test";
import {configureService, createModelService, deepSeekKey} from "./model-service";
import type {ChatModel} from "../src/domain/chat-model";

test("workbench settings credentials stay separate from runtime model and tool credentials", () => {
  const old = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "deployment-fixture";
  try {
    const settings = createModelService();
    const deepSeek: ChatModel = {executor:"codex",model:"deepseek-flash",provider:"deepseek"};
    const custom: ChatModel = {executor:"codex",model:"test",provider:"custom",endpoint:"https://example.invalid/v1"};
    settings.setServiceKey(deepSeek,"settings-fixture");
    settings.setServiceKey(custom,"custom-fixture");

    const browser: NodeJS.ProcessEnv = {};
    settings.configureService(deepSeek,[],browser);
    assert.equal(browser.ONEEARTH_EXECUTOR_KEY,"settings-fixture");
    const runtime: NodeJS.ProcessEnv = {};
    configureService(deepSeek,[],runtime);
    assert.equal(runtime.ONEEARTH_EXECUTOR_KEY,"deployment-fixture");
    assert.equal(deepSeekKey(),"deployment-fixture");
    assert.throws(() => configureService(custom,[],{}), /API Key/);
  } finally {
    if (old===undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = old;
  }
});
