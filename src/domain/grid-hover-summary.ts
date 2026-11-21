import type {Asset} from "./datasets";
import {productKey} from "./product-distribution";
import {accessMembership} from "./data-access";

/** Build once per catalogue/filter revision; only indexed member keys are visited on hover. */
export function indexGridAccess(items:Asset[]) {
  const index=new Map<string,{entity:boolean;clues:Set<string>;timely:Set<string>}>();
  for(const asset of items) {
    const key=productKey(asset);if(!key)continue;
    const row=index.get(key)||{entity:false,clues:new Set<string>(),timely:new Set<string>()};
    const access=accessMembership(asset);
    row.entity ||= access.entities;
    if(access.clues)row.clues.add(asset.id);
    if(access.timely)row.timely.add(asset.id);
    index.set(key,row);
  }
  return index;
}

export function summarizeGridAccess(members:ReadonlySet<string>,index:ReturnType<typeof indexGridAccess>) {
  let entities=0,clues=0,timely=0,unknown=0;
  for(const key of members) {
    const row=index.get(key);
    if(!row){unknown++;continue;}
    entities+=Number(row.entity);clues+=row.clues.size;timely+=row.timely.size;
  }
  return {total:members.size,entities,clues,timely,complete:unknown===0};
}
