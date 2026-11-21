import {pickedSamples} from "../../server/question-grid";
import test from "node:test";
import assert from "node:assert/strict";
import {gridScope,timeScope,scopedQuestionContext,mergeScope,scopeKey} from "./question-scope";
import {cellAt,gridSpec,emptyFilters} from "./spatial";
import {validContext} from "./context-validation";
import {conversationScope} from "../../server/conversation-scope";
import {fallbackDataSearch} from "../../server/data-search";
import type {Selection} from "./types";

test("freeze the picked grid and precise time independently; removals never restore ambient scope",()=>{
  const grid=gridSpec("s2",2),point:[number,number]=[107,30];
  const selected:Selection={grid,id:cellAt(point,grid),point};
  const f={...emptyFilters(),utcWindow:[Date.UTC(2023,6,1),Date.UTC(2023,7,1)] as [number,number]};
  const refs=[gridScope(selected,"中国"),...timeScope(f)];
  const ctx=scopedQuestionContext(refs,null);
  point[0]=110;f.utcWindow[0]=0;
  assert.equal(ctx.selection!.point[0],107);
  assert.equal(ctx.filters.utcWindow![0],Date.UTC(2023,6,1));
  assert.deepEqual(conversationScope(ctx,{...fallbackDataSearch("这里有哪些记录？"),conversationPeriod:null,conversationWindow:null}).filters,ctx.filters);
  assert.ok(validContext(ctx));
  assert.equal(scopedQuestionContext(refs.filter(i=>scopeKey(i)!=="time"),null).filters.period,null);
  assert.equal(scopedQuestionContext([],null).selection,null);
  const changed={...ctx,selection:{...selected,id:cellAt([15,30],grid)}};
  assert.equal(validContext(changed),false);
});
test("several chosen datasets retain their exact record and edition; repeated picks do not duplicate",()=>{
  const a={kind:"dataset" as const,id:"a",title:"产品",source:"发布者",version:"061"},b={...a,id:"b",version:"062"};
  const merged=mergeScope([a],[a,b]);
  assert.equal(merged.length,2);
  const ctx=scopedQuestionContext(merged,null);
  assert.deepEqual(ctx.candidateIds,["a","b"]);assert.deepEqual(ctx.candidateVersions,{a:"061",b:"062"});
  assert.ok(validContext(ctx));
  assert.equal(validContext({...ctx,attachedScope:[a,a]}),false);
});

test("only rows in the actual grid and selected time are local evidence; an undated pixel is not a dated observation",()=>{
  const grid=gridSpec("h3",6),point:[number,number]=[107,30];
  const g=gridScope({grid,id:cellAt(point,grid),point},"");
  const rows=[[107,30,"2023-05-10",8],[90,60,"2023-05-10",3],[107,30,"",2]];
  const tabs=[{kind:"table" as const,label:"格点样本",columns:["经度","纬度","时间","读数"],rows}];
  const samples=pickedSamples(tabs,scopedQuestionContext([g,...timeScope({...emptyFilters(),period:[2023,2023]})],null));
  assert.deepEqual(samples?.[0].rows,[["107","30","2023-05-10","8"]]);
});
