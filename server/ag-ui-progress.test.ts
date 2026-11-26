import test from "node:test";
import assert from "node:assert/strict";
import {EventSchema} from "@ag-ui/core/schemas";
import {agUiProgressStep} from "./ag-ui-persistence";
import {nativeAgUiStepLabels} from "../src/domain/native-agui-progress";

test("public progress accepts only original bounded lifecycle fields and fixed standard step names",()=>{
 const cases:[Record<string,unknown>,string][]=[
  [{chatPhase:"foreground"},"foreground"],
  [{runtimePhase:{phase:"queued"},chatPhase:"research"},"research-queued"],
  [{runtimePhase:{phase:"executing"}},"research-executing"],
  [{runtimePhase:{phase:"waiting-discovery"}},"discovery-wait"],
  [{runtimePhase:{phase:"waiting-discovery",operation:"discover"}},"discovery-wait"],
  [{runtimePhase:{phase:"waiting-discovery",operation:"read"}},"source-read-wait"],
  [{runtimePhase:{phase:"resuming"}},"research-resuming"],
 ];
 for(const [payload,expected] of cases){assert.equal(agUiProgressStep(payload),expected);for(const type of ["STEP_STARTED","STEP_FINISHED"])assert.equal(EventSchema.parse({type,stepName:expected}).type,type);assert.ok(Object.hasOwn(nativeAgUiStepLabels,expected));}
 for(const payload of [
  {stage:"PRIVATE_STAGE",call:{input:"PRIVATE_INPUT",output:"PRIVATE_OUTPUT"}},
  {providerReasoning:[{text:"PRIVATE_THOUGHT"}]},{phase:"executing"},{chatPhase:"research"},
  {runtimePhase:"executing"},{runtimePhase:{phase:"working"}},
  {runtimePhase:{phase:"waiting-discovery",operation:"unregistered"}},
  {runtimePhase:{phase:"failed"}},{runtimePhase:{phase:"cancelled"}},{runtimePhase:{phase:"complete"}},
  {runtimePhase:{phase:"cancel-pending"}},
  {chatPhase:"foreground",runtimePhase:{phase:"unknown"}},
  {remoteStop:{state:"confirmed"},runtimePhase:{phase:"executing"}},
 ])assert.equal(agUiProgressStep(payload),undefined);
});
