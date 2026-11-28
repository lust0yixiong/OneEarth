import path from "node:path";
import { mkdirSync } from "node:fs";
import { workTasks } from "./task-store";
import { postgresTaskStore } from "./postgres-task-store";
import {observationExecution} from "./observation-execution";
import {runtimeWorkerRunner} from "./runtime-worker-runner";
import {runtimeWebToolStore} from "./runtime-web-tool-store";
import { requestPerformance, type ExecutorTiming } from "./request-performance";
import {runtimeServices} from "./runtime-services";
import {closeRuntimeModelCapacity} from "./runtime-model-capacity";

const state = process.env.ONEEARTH_STATE_DIR || path.resolve(".local/state");
mkdirSync(state, {recursive:true, mode:0o700});
const tasks=await postgresTaskStore("runtime");
const webTools=await runtimeWebToolStore();
const services=runtimeServices(state,tasks,webTools);
const engine=process.env.ONEEARTH_SKILL_REGISTRY&&(process.env.ONEEARTH_SKILL_SERVICE_TOKEN?.length??0)>=32?
  await observationExecution({follower:process.env.ONEEARTH_OBSERVATION_COORDINATOR==="false"}):undefined;
const runner=runtimeWorkerRunner(services,engine,{chatHandoff:id=>tasks.chat.handoff(id),workspaceEffects:tasks.workspaceEffects,operations:tasks.operations});
const stop=await workTasks(services.tasks, (task, signal, emit) => {
  const timings:ExecutorTiming[]=[];
  return requestPerformance.run(timings, () => runner.run(task,signal,emit));
},{maintenance:runner.maintenance});
let stopping=false;
const shutdown=()=>{if(stopping)return;stopping=true;void stop().then(()=>engine?.close()).then(async()=>{
  await Promise.all([webTools.close(),services.tasks.close(),closeRuntimeModelCapacity()]);
}).then(()=>process.exit(0),()=>process.exit(1));};
process.once("SIGTERM",shutdown);process.once("SIGINT",shutdown);
console.log("OneEarth runtime worker started");
