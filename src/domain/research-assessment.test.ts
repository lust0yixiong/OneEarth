import test from "node:test";
import assert from "node:assert/strict";
import { cases } from "./catalog";
import { assets } from "./datasets";
import { evaluateBatch } from "./research-assessment";
import { emptyFilters } from "./spatial";
import type { CandidateSet } from "./types";

function batch(
  caseId: string,
  ids = assets.filter((a) => a.caseId === caseId).map((a) => a.id),
  period: [number, number] | null = null,
): CandidateSet {
  return {
    caseId,
    ids,
    title: caseId,
    filters: { ...emptyFilters(), period },
    gridSystem: "h3",
    selection: null,
    layer: "all",
    camera: { center: [0, 0], zoom: 0, reason: "" },
  };
}
const finding = (b: CandidateSet, id: string) =>
  evaluateBatch(b).findings.find((f) => f.id === id)!;

test("all 20 research tasks return traceable input roles, evidence and separate compatibility checks", () => {
  const research = cases.filter((c) => /^Q\d\d$/.test(c.id));
  assert.equal(research.length, 20);
  for (const c of research) {
    const a = evaluateBatch(batch(c.id));
    assert.ok(a.roles.length >= 2, c.id);
    for (const id of [
      "years",
      "access",
      "requirements",
      "measurement",
      "space",
    ])
      assert.ok(
        a.findings.some((f) => f.id === id),
        c.id + id,
      );
    for (const row of [...a.roles, ...a.findings]) {
      assert.ok(row.detail && row.evidenceIds.length, c.id + row.id);
      assert.ok(
        row.evidenceIds.every((ref) =>
          a.evidence.some((e) => e.id === ref && e.detail),
        ),
        c.id + row.id,
      );
    }
  }
});
test("Q15 noise puts an upper bound on candidate years and cannot prove cohort eligibility", () => {
  const b = batch("Q15");
  assert.equal(finding(b, "years").status, "无交集");
  assert.match(finding(b, "years").detail, /AMIGO 2011–2016/);
  assert.match(finding(b, "years").detail, /2021/);
  assert.equal(finding(b, "access").status, "需申请");
  assert.equal(evaluateBatch(b).status, "年份不相交");
  assert.equal(
    finding(batch("Q15", b.ids, [2000, 2005]), "years").status,
    "无交集",
  );
});
test("selecting MODIS instead of Sentinel meets the green-exposure candidate role; omitting both leaves a gap", () => {
  const b = batch("Q15", ["Q15-0", "Q15-2", "Q15-3", "Q15-5"]);
  assert.ok(
    evaluateBatch(b)
      .roles.filter((r) => r.required)
      .every((r) => r.assetIds.length),
  );
  const restricted = evaluateBatch({ ...b, ids: b.ids.slice(0, 3) });
  assert.equal(restricted.status, "年份不相交");
  assert(
    restricted.roles.some(
      (r) => r.required && r.assetIds.length === 0 && r.title.includes("绿"),
    ),
  );
});
test("Q08 requires both local series, counts valid months and distinguishes optional field coverage", () => {
  const pair = ["Q08-0", "Q08-1"];
  const matched = evaluateBatch(batch("Q08", pair, [2000, 2003]));
  assert.equal(matched.status, "可按月配对");
  assert.match(matched.summary, /4 对有效 9 月记录/);
  assert.match(finding(batch("Q08", pair), "years").detail, /47 对/);
  assert.equal(
    finding(batch("Q08", pair, [1960, 1970]), "years").status,
    "本地无交集",
  );
  const all = batch("Q08");
  assert.equal(finding(all, "months").status, "实表已配对");
  assert.match(
    finding(all, "years").detail,
    /1979-09 至 2015-09 的 37 个 9 月/,
  );
  assert.equal(evaluateBatch(batch("Q08", ["Q08-0"])).status, "核心资料不全");
});
test("Q10 time intersection uses meteorological inputs and flags independently unverified WPS compatibility", () => {
  const all = batch("Q10");
  assert.match(finding(all, "years").detail, /1982–2024/);
  assert.match(finding(all, "versions").detail, /v3.8.1.*6 小时.*ERA5/);
  assert.match(finding(all, "versions").detail, /Vtable/);
  assert.equal(finding(all, "versions").status, "需试算验证");
  const missing = batch("Q10", ["Q10-0", "Q10-1", "Q10-2"]);
  assert.match(finding(missing, "versions").detail, /本批尚缺单层与土壤场/);
});
test("object-key checks and local measurements remain distinct from model estimates and missing geometry", () => {
  assert.match(finding(batch("Q20"), "space").detail, /RGI60-01.00709/);
  assert.equal(
    finding(batch("Q20", ["Q20-0"]), "space").status,
    "需核对关联键",
  );
  assert.match(
    evaluateBatch(batch("Q20")).roles.find((r) => r.id === "role-3")!.status,
    /实测尚缺/,
  );
  assert.match(finding(batch("Q02"), "space").detail, /Hintereisferner/);
});
test("no batch inputs, mixed tasks or a lone catalog entry cannot establish joint use", () => {
  assert.equal(evaluateBatch(batch("Q08", [])).status, "核心资料不全");
  assert.equal(
    evaluateBatch({ ...batch("Q08", ["Q01-1", "Q08-0"]), caseId: null }).status,
    "共同用途待确定",
  );
  assert.equal(
    evaluateBatch(batch("Q15", ["Q01-0"])).roles.flatMap((r) => r.assetIds)
      .length,
    0,
  );
});

test("an unverified ERA5-Land version from another study cannot satisfy the Q02 hourly requirement", () => {
  const a = evaluateBatch(batch("Q02", ["Q07-3"]));
  assert(!a.roles.some((r) => r.assetIds.includes("Q02-1")));
  assert(a.roles.every((r) => r.assetIds.length === 0));
});

test("a 2002 survey cannot use Sentinel-2 scenes to measure contemporaneous exposure", () => {
  assert.equal(finding(batch("Q11"), "years").status, "无交集");
});

test("published 79 North altimetry epochs do not overlap the archived CTD cruises",()=>{
 for(const material of ["Q19-3/ATM","Q19-3/TanDEM-X"]){
   const result=finding(batch("Q19",[material,"Q19-4"]),"years");
   assert.equal(result.status,"本地无交集");
   assert.deepEqual(result.evidenceIds,["Q19-4",material]);
 }
});
