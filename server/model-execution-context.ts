import {AsyncLocalStorage} from "node:async_hooks";
import type {TaskStore} from "./task-store";

/** Server-only; a browser model setting cannot select a lane or reserve capacity. */
export type ModelExecutionContext=
  | {role:"foreground"|"background";taskId:string;tasks:TaskStore}
  | {role:"foreground";taskId?:undefined;tasks?:undefined};
export const modelExecutionContext=new AsyncLocalStorage<ModelExecutionContext>();
