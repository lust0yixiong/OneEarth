import assert from "node:assert/strict";
import test from "node:test";
import { assetMaterials } from "./evidence";
import { citeMaterial } from "./evidence-citation";
import { assetById } from "./datasets";
import { emptyFilters } from "./spatial";
import type { EvidenceDocument } from "./types";

test("Q08 citations preserve original data rows, edition and CSV through repeated excerpt reads", () => {
  const filters = emptyFilters();
  const source = assetMaterials(assetById.get("Q08-0")!, filters, null, null);
  const tab = source.tabs.find((t) => t.kind === "table")!;
  const citation = citeMaterial(
    { ...source, id: source.id + "/0", title: tab.label },
    tab,
    1,
  );
  assert.deepEqual(
    citation.locator?.rows,
    Array.from({ length: 12 }, (_, i) => i + 13),
  );
  assert.equal(citation.locator?.version, "v4");
  assert.match(citation.url!, /N_09_extent_v4.0.csv$/);
  assert.match(citation.body, /1991-09.*6.47/);
  assert.deepEqual(
    citeMaterial(citation.excerpt!, citation.excerpt!.tabs[0], 0),
    citation,
  );
  const filtered = assetMaterials(
    assetById.get("Q08-0")!,
    { ...filters, period: [1991, 2002] },
    null,
    null,
  );
  assert.deepEqual(
    citeMaterial(
      filtered,
      filtered.tabs.find((t) => t.kind === "table")!,
      0,
    ).locator?.rows,
    citation.locator?.rows,
  );
  const legacy = {
    ...citation.excerpt!,
    locator: undefined,
    id: "Q08-0/0-excerpt-0-1",
    tabs: [
      {
        ...citation.excerpt!.tabs[0],
        rowNumbers: undefined,
        label: tab.label + " · 第 13–24 行",
      },
    ],
  };
  assert.deepEqual(
    citeMaterial(legacy, legacy.tabs[0], 0).locator?.rows,
    citation.locator?.rows,
  );
});

test("Q15 publishes the HAL edition and page-level link, including when citing a reopened page", () => {
  const doc = assetMaterials(
    assetById.get("Q15-3")!,
    emptyFilters(),
    null,
    null,
  );
  const tab = doc.tabs.find((t) => t.kind === "pdf")!;
  const cite = citeMaterial(doc, tab, 0);
  assert.equal(
    cite.url,
    "https://hal.science/hal-04769423v1/file/Saucy_2023.pdf#page=4",
  );
  assert.equal(cite.locator?.version, "HAL v1");
  assert.equal(cite.locator?.page, 4);
  assert.deepEqual(citeMaterial(cite.excerpt!, cite.excerpt!.tabs[0], 0), cite);
});

test("code and text keep source identity and excerpt-relative lines", () => {
  for (const kind of ["code", "text"] as const) {
    const doc: EvidenceDocument = {
      id: "test",
      title: "样例",
      version: "r3",
      url: "/record",
      source: "归档",
      scope: "测试",
      tabs: [
        { kind, label: "片段", body: "first\nsecond", url: "/record/material" },
      ],
    };
    const cite = citeMaterial(doc, doc.tabs[0], 0);
    assert.deepEqual(cite.locator?.lines, [1, 2]);
    assert.equal(cite.url, "/record/material");
    assert.equal(cite.locator?.version, "r3");
    assert.deepEqual(
      citeMaterial(cite.excerpt!, cite.excerpt!.tabs[0], 0),
      cite,
    );
  }
});

test("remote PDF text citations preserve actual page, source URL and extracted text through repeated reads",()=>{
  const doc:EvidenceDocument={id:'web-pdf',title:'Published article',scope:'来源网页',source:'Publisher',tabs:[]};
  const tab={kind:'text' as const,label:'PDF 第 3 页文字摘录',body:'Measured atmospheric radiance.\nActual extracted page text.',sourcePage:3,url:'https://publisher.org/download?id=1#page=3'};
  const citation=citeMaterial(doc,tab,0);
  assert.equal(citation.locator?.kind,'pdf');assert.equal(citation.locator?.page,3);
  assert.equal(citation.body,tab.body);assert.equal(citation.url,tab.url);
  assert.deepEqual(citeMaterial(citation.excerpt!,citation.excerpt!.tabs[0],0),citation);
});
