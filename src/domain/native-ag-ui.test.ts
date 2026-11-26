import assert from "node:assert/strict";
import test from "node:test";
import { EventSchema, RunAgentInputSchema } from "@ag-ui/core/schemas";
import {
  nativeAgUiProtocolVersion, oneEarthAgUiVersion, readOneEarthAgUiResult,
  readOneEarthAgUiSubmission, type OneEarthAgUiForwardedProps, type OneEarthAgUiResult,
} from "./native-ag-ui";

test("the native AG-UI input preserves the versioned workbench submission", () => {
  const submission = { previousTaskId:"prior-run", context:{view:"globe"} };
  const forwardedProps: OneEarthAgUiForwardedProps<typeof submission> = {
    oneearth:{version:oneEarthAgUiVersion,submission},
  };
  const input = RunAgentInputSchema.parse({
    protocolVersion:nativeAgUiProtocolVersion, threadId:"thread", runId:"run",
    messages:[{id:"turn",role:"user",content:"检查协议。"}],
    state:{}, tools:[], context:[], forwardedProps,
  });
  assert.equal(input.protocolVersion,"1.0");
  assert.equal(input.messages.at(-1)?.id,"turn");
  assert.deepEqual(readOneEarthAgUiSubmission(input.forwardedProps),submission);
  assert.equal(readOneEarthAgUiSubmission({oneearth:{version:2,submission}}),undefined);
  assert.equal(readOneEarthAgUiSubmission({oneearth:{version:1,submission:[]}}),undefined);
});

test("the native AG-UI terminal response is bound to its assistant message", () => {
  const response = { message:"已核对原资料。" };
  const result: OneEarthAgUiResult = {
    oneearth:{version:oneEarthAgUiVersion,messageId:"run",response},
  };
  const event = EventSchema.parse({
    type:"RUN_FINISHED", threadId:"thread", runId:"run", result,
  });
  assert.equal(event.type,"RUN_FINISHED");
  assert.deepEqual(readOneEarthAgUiResult(event.result,"run"),response);
  assert.equal(readOneEarthAgUiResult(event.result,"other-run"),undefined);
  assert.equal(readOneEarthAgUiResult({oneearth:{version:1,messageId:"run",response:{message:3}}},"run"),undefined);
});
