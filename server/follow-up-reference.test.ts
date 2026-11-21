import {test} from "node:test";
import assert from "node:assert/strict";
import { numberedFollowUp } from "./follow-up-reference";
import type { DiscoveryResponse } from "../src/domain/types";

const local={kind:"asset",title:"本地资料",id:"local",source:"local",sourceChannel:"local"} as const;
const first={kind:"asset",title:"第一篇",id:"p1",source:"paper",sourceChannel:"assertion"} as const;
const second={...first,id:"p2",title:"第二篇"} as const;
const website={kind:"web",title:"公开网页",url:"https://example.org/",sourceChannel:"web"} as const;
const prior={answerNotes:{references:[local,first,website,second]}} as DiscoveryResponse;

test("natural literature ordinals use order within the literature channel",()=>{
  for(const text of ["第二篇论文用了什么数据？","上次回答里，作者在第 ２ 篇文献用了什么？","第2篇文献里用的什么测量方法？"])
    assert.deepEqual(numberedFollowUp(text,prior),{ordinal:2,scope:"literature",reference:second});
});
test("citation markers follow the displayed, mixed-source ordering",()=>{
  assert.equal(numberedFollowUp("能讲讲依据〔3〕里的时间范围吗？",prior)?.reference,website);
  assert.equal(numberedFollowUp("〔3〕里怎么描述时间范围？",prior)?.reference,website);
  assert.equal(numberedFollowUp("上一条回复的来源编号 2，哪里可以查到方法？",prior)?.reference,first);
  assert.equal(numberedFollowUp("What is the scale in reference #3?",prior)?.reference,website);
});
test("multiple references and new research requests keep the general planning path",()=>{
  assert.equal(numberedFollowUp("对比第二篇文献和第三篇文献的结果。",prior),undefined);
  assert.equal(numberedFollowUp("按第二篇论文的方法另找一些新资料。",prior),undefined);
  assert.deepEqual(numberedFollowUp("第九篇论文用了什么数据？",prior),{ordinal:9,scope:"literature",reference:undefined});
  assert.equal(numberedFollowUp("第二篇论文用了什么数据？"),undefined);
});
