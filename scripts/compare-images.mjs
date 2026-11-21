import sharp from "sharp";
import { writeFile } from "node:fs/promises";
const publication = process.env.ONEEARTH_VISUAL_RELEASE || "a2-release";
const old = "../oneearth-goal-handoff/界面参考";
const pairs = [
 ["首页与 Chat",old+"/首页与Chat.png","evidence/"+publication+"/home.png"],
 ["Chat 收起",old+"/地球工作区.png","evidence/"+publication+"/globe.png"],
 ["回答","evidence/visual/baseline/answer.png","evidence/visual/next/answer.png"],
 ["网页预览","evidence/visual/baseline/web-preview.png","evidence/visual/next/web-preview.png"],
 ["PDF 预览","evidence/visual/baseline/pdf-preview.png","evidence/visual/next/pdf-preview.png"],
 ["选格","evidence/visual/baseline-map/selected-grid.png","evidence/a3-spatial/selected-grid.png"],
];
const values=[];
for(const [label,left,right] of pairs){
  const [a,b]=await Promise.all([left,right].map(file=>sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true})));
  if(a.info.width!==b.info.width || a.info.height!==b.info.height || a.info.channels!==b.info.channels)
    throw Error(label+" 对照图的视口不一致。");
  const {width,height,channels}=a.info;
  const regions={header:{changed:0,pixels:0},leftNav:{changed:0,pixels:0},body:{changed:0,pixels:0}};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const region=regions[y<65?"header":x<51?"leftNav":"body"],start=(y*width+x)*channels;
    region.pixels++;
    if(a.data[start]!==b.data[start] || a.data[start+1]!==b.data[start+1] || a.data[start+2]!==b.data[start+2])region.changed++;
  }
  values.push({label,left,right,width,height,regions});
}
await writeFile("evidence/visual/pairs.json",JSON.stringify(values,null,2)+"\n");
