import {AsyncLocalStorage} from "node:async_hooks";
export type RuntimeTaskLease={id:string;owner:string;fence:number};
export const runtimeTaskLease=new AsyncLocalStorage<RuntimeTaskLease|undefined>();
export const runtimeTaskLeaseMs=15000;
export function runtimeStepConcurrency(){const value=Number(process.env.ONEEARTH_RUNTIME_STEP_CONCURRENCY??2);if(!Number.isSafeInteger(value)||value<1||value>32)throw Error("后台步骤并发配置无效。");return value;}
