export const workspaceOperationKinds = [
  "open-saved", "open-research-lists", "return-to-results", "save-current", "save-checked", "save-batch",
  "adopt-research-range", "clear-research-range", "present-catalogue",
] as const;

export type WorkspaceOperationKind = typeof workspaceOperationKinds[number];
export const workspaceCandidateKinds = ["open-candidate", "compare-candidates"] as const;
export type WorkspaceCandidateKind = typeof workspaceCandidateKinds[number];
export type WorkspaceCandidateItem = {id: string; label: string};
export type WorkspaceOperation =
  | {kind: Exclude<WorkspaceOperationKind,"present-catalogue">}
  | {kind:"present-catalogue"; batchId:string}
  | {kind: WorkspaceCandidateKind; ids: string[]};

export function validWorkspaceOperationKind(value: unknown): value is WorkspaceOperationKind {
  return workspaceOperationKinds.some(kind => kind === value);
}

/** The planner selects the operation; the current user's wording grants permission. */
export function authorizesResearchRangeAdoption(question:string) {
  const text=question.trim();
  if(!text || /[？?「」“”"`]|(?:不要|不用|不必|无需|别|不想|暂不|不应|如果|假如|举例|为什么|如何|怎么|是否|多少|先确认|等我确认)|\b(?:don't|do not|not|why|how|whether|if|example|confirm first)\b/iu.test(text))
    return false;
  if(/(?:只|仅)(?:在|限)?(?:本轮|本次请求|这一次|此次)|本轮(?:临时|只|仅)|\b(?:only this time|just (?:this )?once|one-time|for this request only)\b/iu.test(text))
    return false;
  const command=text.replace(/^(?:(?:请|帮我|麻烦|我想|我希望|我们|please\b)\s*)+/iu,"");
  if(!/^(?:把|将|采用|选用|改用|用|就用|设|定为|选作|(?:接下来|接着|以后|本次)\s*(?:就|请)?\s*(?:用|把|采用))|^(?:(?:i want you to|let's)\s+)?(?:adopt|use|set|make)\b/iu.test(command))
    return false;
  const selection=/(?:当前|现在|刚刚?|眼前|这个|这一|已|所|高亮)[^。！？；\n]{0,12}(?:选格|网格|格子|一格)|\b(?:current|selected|highlighted|this)\s+(?:H3\s+)?(?:grid\s+)?cell\b/iu.test(text);
  const adoption=/(?:采用|设为|设成|作为|用作|定为|改用|选作|纳入)|\b(?:adopt|use|set|make)\b/iu.test(text);
  return selection&&adoption&&(/研究[^。！？；\n]{0,8}(?:范围|区域|条件)|(?:范围|区域|条件)[^。！？；\n]{0,8}研究|\bresearch\s+(?:scope|area|range)\b/iu.test(text)||
    /^(?:请\s*|帮我\s*)?采用(?:当前|刚刚?)选格[。！!]?$/u.test(text));
}

export function authorizesResearchRangeClear(question:string) {
  const text=question.trim();
  if(!text||/[？?「」“”"`]|(?:不要|不用|不必|无需|别|不想|暂不|如果|假如|举例|为什么|如何|怎么|是否|先确认|等我确认)|\b(?:don't|do not|not|why|how|whether|if|example|confirm first)\b/iu.test(text))return false;
  const command=text.replace(/^(?:(?:请|帮我|麻烦|我想|我希望|我们|please\b)\s*)+/iu,"");
  return /^(?:清除|清空|取消|移除|撤销|去掉)\s*(?:我在|会话里|会话中|会话|当前|原来|已保存|已采用|之前|先前|保存的|采用的|设定的|默认|的|所|研究中|\s){0,16}(?:研究范围|研究区域|研究条件)(?:[。！!.]|$)/u.test(command)||
    /^(?:clear|remove|unset|reset)\s+(?:(?:the|my|our|adopted|current|saved|previous|default|existing)\s+){0,5}research\s+(?:scope|area|range)(?:[.!]|$)/iu.test(command);
}

export function workspaceCandidateOperationAllowed(items: WorkspaceCandidateItem[] | undefined,
  kind: unknown, ids: unknown): ids is string[] {
  if (!items || !Array.isArray(ids) || new Set(ids).size !== ids.length ||
    !ids.every(id => typeof id === "string" && items.some(item => item.id === id))) return false;
  return kind === "open-candidate" ? ids.length === 1 : kind === "compare-candidates" && ids.length >= 2 && ids.length <= 6;
}
