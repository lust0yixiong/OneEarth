import {AsyncLocalStorage} from 'node:async_hooks';
export interface ExecutorTiming {
  kind:'model-executor'; model:string; executor:string; startedAt:number;
  activeAtStart:number; localQueueMs:number; spawnMs?:number; firstStdoutMs?:number;
  elapsedMs:number; promptBytes:number; outputBytes:number;
}
// Request-local only: no prompts, credentials or unrelated users' diagnostics.
export const requestPerformance=new AsyncLocalStorage<ExecutorTiming[]>();
