import test from "node:test";
import assert from "node:assert/strict";
import { materialAnswer } from "./material-summary";
import { emptyFilters } from "./spatial";
import type { CandidateSet } from "./types";

function summary(ids: string[], period: [number, number] | null = null) {
  const batch: CandidateSet = {
    ids,
    title: "材料",
    caseId: null,
    filters: { ...emptyFilters(), period },
    selection: null,
    layer: "all",
    camera: { zoom: 1, center: [0, 0], reason: "测试" },
    gridSystem: "h3",
  };
  return materialAnswer(batch);
}
test("station extremes, monthly indices and application evidence keep their own units", () => {
  assert.match(summary(["dongting-0"]), /2 条年报水位记录.*31.34/);
  assert.match(summary(["manaus-0"], [2024, 2024]), /1 条年报水位记录.*12.11/);
  const index = summary(["Q08-1"], [2000, 2002]);
  assert.match(index, /3 个月份/);
  assert.doesNotMatch(index, /景|站点/);
  assert.match(summary(["Q15-3"]), /第 4 页.*申请条件/);
  assert.match(summary(["Q10-0"]), /产品说明与获取入口/);
  assert.match(summary(["Q14-0"]), /边界的来源记录/);
  assert.match(summary(["Q19-4"]), /剖面站次.*层采样记录/);
});
