/** Public lifecycle facts, never execution/lease authority. */
export type RuntimePhase={phase:"queued"|"executing"|"waiting-discovery"|"resuming"|"cancel-pending"|"complete"|"failed"|"cancelled";operation?:"discover"|"read"};
export type RemoteStop={discoveryTaskId:string;state:"pending"|"confirmed"|"unconfirmed";remoteState?:string};
