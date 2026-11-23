import test from "node:test";
import assert from "node:assert/strict";
import { authorizesWorkspaceViewAction, c40CityPublicationRevision, validWorkspaceViewContext, workspaceViewActionAllowed, type WorkspaceViewContext } from "./workspace-view-context";

const current = {id:"2023-01-15",label:"2023-01-15"};
const august = {id:"2023-08-15",label:"2023-08-15"};
const view: WorkspaceViewContext = {
  version:1,surface:"earth",
  map:{mode:"catalog",camera:{center:[123.06,49.95],zoom:8},gridSystem:"h3",layer:"all",mesh:false,
    filters:{type:"",source:"",place:"",period:null,utcWindow:null,depth:null,maxDem:null}},
  activeLayer:{id:"forest",title:"森林图层",datasetId:"haina:1846764",status:"ready",
    display:[{label:"图例",value:"RGB 分别显示前三个主成分"}],
    controls:[{id:"time",label:"当前日期",current,options:[current,august],ordered:true}]},
};
const action = {kind:"set-control",layerId:"forest",controlId:"time",valueId:august.id};

test("workspace view validates only bounded visible facts and available choices", () => {
  assert.equal(validWorkspaceViewContext(view),true);
  assert.equal(validWorkspaceViewContext({...view,authorization:{read:true}}),false);
  assert.equal(validWorkspaceViewContext({...view,focus:{kind:"evidence",title:"资料",body:"原件正文"}}),false);
  assert.equal(validWorkspaceViewContext({...view,display:[{label:"当前页面",value:"在看图层",body:"未展示的来源正文"}]}),false);
  assert.equal(validWorkspaceViewContext({...view,map:{...view.map,camera:{center:[225,10],zoom:8}}}),false);
  const activeLayer = view.activeLayer!;
  assert.equal(validWorkspaceViewContext({...view,activeLayer:{...activeLayer,status:"loading"}}),false);
  const choice = activeLayer.controls[0];
  for(const options of [[august],[current,current],Array.from({length:37},(_,i)=>({id:"month-"+i,label:"月份 "+i}))])
    assert.equal(validWorkspaceViewContext({...view,activeLayer:{...activeLayer,controls:[{...choice,options}]}}),false);
});

test("workspace actions bind only to a choice currently offered by the active control", () => {
  assert.equal(workspaceViewActionAllowed(view,action),true);
  assert.equal(workspaceViewActionAllowed(undefined,action),false);
  assert.equal(workspaceViewActionAllowed(view,{...action,valueId:"2022-08-15"}),false);
  assert.equal(workspaceViewActionAllowed(view,{...action,controlId:"city"}),false);
  assert.equal(workspaceViewActionAllowed(view,{...action,camera:{center:[0,0]}}),false);
  assert.equal(workspaceViewActionAllowed({...view,activeLayer:{...view.activeLayer!,id:"rain"}},action),false);
});


test("permission requires a direct UI request independently of a valid target", () => {
  for(const query of ["切换到上海看看","切到下一个。","请把时效改成 F012","下一期"])
    assert.equal(authorizesWorkspaceViewAction(query),true,query);
  for(const query of ["我现在看的这期是哪年哪月？","把时效改成 F012 和当前有什么区别？","不要切换到上海","我刚才切到上海了","把城市改成上海会怎样","切换到上海，但不要执行"])
    assert.equal(authorizesWorkspaceViewAction(query),false,query);
});


test("published city actions require the same revision and an exact declared choice", () => {
  const revision="a".repeat(64);
  const snapshot: WorkspaceViewContext = {
    version:1,surface:"earth",activeLayer:{id:"c40",title:"C40 城市",status:"ready",
      controls:[{id:"city",label:"城市",current:{id:"beijing-chn",label:"北京"},
        options:[{id:"beijing-chn",label:"北京"}],ordered:true,publication:{kind:"c40-cities",revision,total:95}}]},
  };
  const move = {kind:"set-control",layerId:"c40",controlId:"city",valueId:"late-city",publicationRevision:revision};
  const fromDirectory = (source:{revision:string},id:string)=>source.revision===revision&&id==="late-city";
  assert.equal(c40CityPublicationRevision('"'+revision+'"'),revision);
  assert.equal(c40CityPublicationRevision('W/"'+revision+'"'),undefined);
  assert.equal(validWorkspaceViewContext(snapshot),true);
  assert.equal(workspaceViewActionAllowed(snapshot,move),false);
  assert.equal(workspaceViewActionAllowed(snapshot,move,fromDirectory),true);
  assert.equal(workspaceViewActionAllowed(snapshot,{...move,publicationRevision:"b".repeat(64)},fromDirectory),false);
  assert.equal(workspaceViewActionAllowed(snapshot,{...move,publicationRevision:undefined},fromDirectory),false);
  assert.equal(workspaceViewActionAllowed(snapshot,{...move,valueId:"not-published"},fromDirectory),false);
});

test("forest membership outside the browser window requires its own publication identity",()=>{
  const revision="5".repeat(64),past={id:"2016-05-14",label:"2016-05-14"};
  const control={id:"time",label:"森林时相",current:past,options:[past],ordered:true,
    publication:{kind:"forest-frames" as const,revision,total:4791}};
  const activeLayer={...view.activeLayer!,controls:[control]};
  const snapshot:WorkspaceViewContext={...view,activeLayer};
  const desired={...action,valueId:"2024-03-26",publicationRevision:revision};
  const published=(publication:{kind:string;revision:string},date:string)=>
    publication.kind==="forest-frames"&&publication.revision===revision&&date===desired.valueId;
  assert.ok(validWorkspaceViewContext(snapshot));
  assert.ok(!validWorkspaceViewContext({...snapshot,activeLayer:{...activeLayer,id:"c40"}}));
  assert.ok(!validWorkspaceViewContext({...snapshot,activeLayer:{...activeLayer,controls:[{...control,id:"city"}]}}));
  assert.ok(!workspaceViewActionAllowed(snapshot,desired));
  assert.ok(workspaceViewActionAllowed(snapshot,desired,published));
  assert.ok(!workspaceViewActionAllowed(snapshot,{...desired,publicationRevision:"2".repeat(64)},published));
});
