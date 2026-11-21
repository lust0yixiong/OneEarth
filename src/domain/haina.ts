import snapshot from "../data/evidence/haina.json";
import type { Need } from "./types";
import type {HainaRecord} from "./haina-record";

import {hainaSpace,hainaExtentEvidence} from "./haina-space";
export function hainaNeed(record:HainaRecord,synced:string,endpoint?:string):Need {
    const url="https://cn.zero2x.org/data-hub/portal/dataset?id="+record.id+"&lang=zh";
    const types=record.labels.filter(l=>l.group==="1007").map(l=>l.name);

    return {
      holding:{channelId:"haina",channelName:"海纳",access:record.access==="Public"?"public":record.access==="Limited"?"restricted":"unknown"},
      canonicalId:/^10\.\d{4,9}_[^\s]+$/i.test(record.sourceIdentifier||"")?"doi:"+record.sourceIdentifier!.replace("_","/").toLowerCase():undefined,
      name:record.name,product:record.name,datasetId:"haina:"+record.id,
      type:types.join("、")||"形态待核",status:"海纳目录已收录",source:record.source||record.provider||"海纳",
      detail:record.description,url,card:record.card,
      profile:{role:"data",spatial:"coverage",...hainaSpace(record.id,record.name),
        access:[record.provider,record.access,record.license,"详情与文件获取按海纳授权办理"].filter(Boolean).join(" · "),
        limitation:"目录收录与实际观测分开统计。"},
      tabs:[{kind:"code",language:"json",label:"海纳目录元数据",body:JSON.stringify({...record,synced,endpoint,areaId:"2",fileAccess:"dataAddress 为数据地址字段，不能仅凭此字段认定可直接下载；文件按海纳登录和授权获取。",earthMetadata:hainaExtentEvidence(record.id,record.name)},null,2),url}],
    };
}
export const hainaGroup = {
  id: "haina", title: "海纳地学专区",
  needs: snapshot.records.map(record=>hainaNeed(record,snapshot.synced,snapshot.endpoint)),
};
