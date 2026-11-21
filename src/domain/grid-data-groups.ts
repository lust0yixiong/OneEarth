import {distinctAssets,type Asset} from "./datasets";
import {globalProduct,productKey} from "./product-distribution";
import type {Filters} from "./types";
export const gridDataScopes=[
  {id:"local",label:"格内可定位",description:"参与本格着色的数据集"},
  {id:"global",label:"全球覆盖",description:"全球覆盖资料，单独列出，不参与着色"},
  {id:"coverage",label:"范围及其他说明",description:"范围元数据及其他关联依据，不参与着色"},
  {id:"all",label:"全部关联",description:"包含格内定位、全球覆盖与范围说明"},
] as const;
export type GridDataScope=typeof gridDataScopes[number]["id"];
/** Product categories partition records consistently, even when one dataset has
 * multiple source records, points and a catalogue envelope. Retain every edition. */
export function groupGridData(items:Asset[],localKeys:ReadonlySet<string>,filters:Filters) {
  const all=distinctAssets(items);
  const globals=new Set(all.filter(a=>globalProduct(a,filters)).flatMap(a=>productKey(a)||[]));
  const groups:Record<GridDataScope,Asset[]>={local:[],global:[],coverage:[],all};
  for(const asset of all){
    const key=productKey(asset);
    groups[key&&localKeys.has(key)?"local":key&&globals.has(key)?"global":"coverage"].push(asset);
  }
  return groups;
}
