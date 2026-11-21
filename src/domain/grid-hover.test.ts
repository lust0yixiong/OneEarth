import test from "node:test";
import assert from "node:assert/strict";
import {createHoverIntent,gridHoverPlacement} from "../globe/grid-hover";
import {indexGridAccess,summarizeGridAccess} from "./grid-hover-summary";
import {assetById,type Asset} from "./datasets";

test("hover resolves once after one second; small pointer jitter does not restart the wait",t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  let reads=0;const shown:string[]=[];
  const intent=createHoverIntent({resolve:()=>{reads++;return "cell";},show:v=>shown.push(v),hide:()=>{}});
  intent.move(100,100);t.mock.timers.tick(600);intent.move(101,101);t.mock.timers.tick(399);
  assert.equal(reads,0,"moving over the globe performs no hit test before the delay");
  t.mock.timers.tick(1);assert.equal(reads,1);assert.deepEqual(shown,["cell"]);
  intent.move(101,100);t.mock.timers.tick(2000);assert.equal(reads,1);
  intent.cancel();
});

test("moving away restarts the wait; navigation, leaving or disposal cancels pending and visible overviews",t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  const shown:number[]=[];let hidden=0;
  const intent=createHoverIntent({resolve:x=>x,show:x=>shown.push(x),hide:()=>hidden++});
  intent.move(10,10);t.mock.timers.tick(900);intent.move(60,10);t.mock.timers.tick(100);
  assert.deepEqual(shown,[]);intent.cancel();t.mock.timers.tick(1000);assert.deepEqual(shown,[]);
  intent.move(90,10);t.mock.timers.tick(1000);assert.deepEqual(shown,[90]);
  intent.cancel();intent.cancel();assert.equal(hidden,1);
});

test("positions flip near edges and fit a narrow viewport without covering Chat's inset",()=>{
  for(const width of [296,390,800])for(const x of [2,width/2,width-2])for(const y of [2,350,680]){
    const p=gridHoverPlacement(x,y,width,700,230);
    assert.ok(p.left>=12 && p.left+p.width<=width-12);
    assert.ok(p.top>=12 && p.top+230<=688);
  }
  const right=gridHoverPlacement(760,300,800,700,230);
  assert.ok(right.left+right.width<760,"near the right edge, the overview opens to the left");
});

test("summary uses only exact indexed local products; real holdings and clue/observation records keep their units",()=>{
  const base=[...assetById.values()].find(a=>a.kind==="dataset")!;
  const make=(id:string,productId:string,extra:Partial<Asset>={}):Asset=>({...base,id,productId,datasetId:productId,origins:["public"],holding:undefined,...extra});
  const rows=[make("held","local",{holding:{channelId:"new-channel",channelName:"未来实体渠道",access:"restricted"}}),
    make("paper-a","local"),make("paper-b","local"),make("paper-b","local"),
    make("global","global"),make("metadata","metadata"),make("received","received",{origins:["constellation"]})];
  const index=indexGridAccess(rows);
  assert.deepEqual(summarizeGridAccess(new Set(["local","received"]),index),{total:2,entities:1,clues:2,timely:1,complete:true});
  assert.deepEqual(summarizeGridAccess(new Set(),index),{total:0,entities:0,clues:0,timely:0,complete:true});
  assert.equal(summarizeGridAccess(new Set(["not-loaded"]),index).complete,false,"missing catalogue records must not be presented as verified zero categories");
});
