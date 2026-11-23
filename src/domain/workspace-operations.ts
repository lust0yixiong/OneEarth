export const workspaceOperationKinds = [
  "open-saved", "open-research-lists", "return-to-results", "save-current", "save-checked", "save-batch",
] as const;

export type WorkspaceOperationKind = typeof workspaceOperationKinds[number];
export const workspaceCandidateKinds = ["open-candidate", "compare-candidates"] as const;
export type WorkspaceCandidateKind = typeof workspaceCandidateKinds[number];
export type WorkspaceCandidateItem = {id: string; label: string};
export type WorkspaceOperation = {kind: WorkspaceOperationKind} | {kind: WorkspaceCandidateKind; ids: string[]};

export function validWorkspaceOperationKind(value: unknown): value is WorkspaceOperationKind {
  return workspaceOperationKinds.some(kind => kind === value);
}

export function workspaceCandidateOperationAllowed(items: WorkspaceCandidateItem[] | undefined,
  kind: unknown, ids: unknown): ids is string[] {
  if (!items || !Array.isArray(ids) || new Set(ids).size !== ids.length ||
    !ids.every(id => typeof id === "string" && items.some(item => item.id === id))) return false;
  return kind === "open-candidate" ? ids.length === 1 : kind === "compare-candidates" && ids.length >= 2 && ids.length <= 6;
}
