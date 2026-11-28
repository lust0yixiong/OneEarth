/** An existing protected run with no valid operation ID stays inaccessible. */
export type WorkspaceDiscoveryArchiveBinding={operationId?:string};

export function isWorkspaceDiscoveryArchiveResult(result:unknown):boolean {
  return !!result&&typeof result==="object"&&Object.hasOwn(result,"workspaceDiscovery");
}
