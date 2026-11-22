import type {TaskStore} from "./task-store";
import type {DiscoveryBinding,DiscoveryA2AOptions} from "./discovery-a2a-client";

export type StoredDiscoveryBinding=DiscoveryBinding&{kind:"initial"|"continuation"};
type PreviousDiscovery=StoredDiscoveryBinding|{transport:"v1";discoveryId:string};

/** Only a same-conversation persisted parent can supply a confirmation binding. */
export async function previousDiscovery(tasks:TaskStore,conversationId:string,parentId:string,waiting=false):Promise<PreviousDiscovery>{
  const parent=await tasks.get(parentId);
  if(!parent||JSON.parse(parent.body).conversationId!==conversationId)throw Error("没有找到同一研究会话的发现委托。");
  let after=0,found:StoredDiscoveryBinding|undefined,hasBinding=false;
  const latest=new Map<string,StoredDiscoveryBinding>();
  for(;;){
    const events=await tasks.events(parentId,after);
    for(const event of events){
      const saved=event.discoveryBinding as StoredDiscoveryBinding|undefined;
      if(event.discoveryBinding!==undefined){
        hasBinding=true;
        if(!saved||saved.transport!=="a2a"||!["initial","continuation"].includes(saved.kind))
          throw Error("已存研究记录的发现绑定无效，不能按旧协议猜测任务。");
        if(typeof saved.messageId!=="string"||!saved.messageId||typeof saved.discoveryId!=="string"||!saved.discoveryId||
          typeof saved.state!=="string"||(saved.lastSeq!==undefined&&(!Number.isSafeInteger(saved.lastSeq)||saved.lastSeq<0)))
          throw Error("已存研究记录的发现受理身份无效。");
        const old=latest.get(saved.messageId);
        if(old&&(old.discoveryId!==saved.discoveryId||(old.contextId!==undefined&&saved.contextId!==undefined&&old.contextId!==saved.contextId)))
          throw Error("发现受理身份发生冲突。");
        latest.set(saved.messageId,saved);
      }
      if(saved?.kind==="initial"){
        if(saved.transport!=="a2a"||saved.messageId!==parentId||typeof saved.discoveryId!=="string"||!saved.discoveryId||
          typeof saved.state!=="string"||(saved.lastSeq!==undefined&&(!Number.isSafeInteger(saved.lastSeq)||saved.lastSeq<0)))
          throw Error("已存研究记录的发现受理身份无效，不能猜测原任务。");
        if(found&&(saved.discoveryId!==found.discoveryId||
          (saved.contextId!==undefined&&found.contextId!==undefined&&saved.contextId!==found.contextId)))
          throw Error("已存研究记录的发现受理身份发生冲突。");
        found=saved;
      }
    }
    if(events.length<128)break;
    const next=events.at(-1)?.seq;
    if(typeof next!=="number"||next<=after)throw Error("发现受理记录无法按序读取。");
    after=next;
  }
  // Archived v1 research records predate explicit bindings and used the same ID.
  if(waiting&&hasBinding){
    const pending=[...latest.values()].filter(b=>b.state==="TASK_STATE_INPUT_REQUIRED");
    if(pending.length!==1||pending[0].lastSeq===undefined)throw Error("该研究记录无法唯一定位当前待补充的受托发现及等待水位。");
    return pending[0];
  }
  if(found)return found;
  if(hasBinding)throw Error("已存研究记录缺少初次发现的受理绑定。");
  return {transport:"v1",discoveryId:parentId};
}

export async function discoveryConfirmation(tasks:TaskStore,conversationId:string,parentId:string):Promise<{
  continuedFrom?:string;newTask?:true;options:Pick<DiscoveryA2AOptions,"target"|"afterSeq">;
}>{
  const record=(await tasks.terminal(parentId))?.result as {runtimeQuestionCheck?:boolean}|undefined;
  if(record?.runtimeQuestionCheck){
    const parent=await tasks.get(parentId);
    if(!parent||JSON.parse(parent.body).conversationId!==conversationId)throw Error("没有找到同一研究会话的问题确认。");
    return {newTask:true,options:{}};
  }
  const parent=await previousDiscovery(tasks,conversationId,parentId);
  if(parent.transport==="a2a"&&["TASK_STATE_INPUT_REQUIRED","TASK_STATE_AUTH_REQUIRED"].includes(parent.state)){
    if(parent.lastSeq===undefined)throw Error("原发现委托缺少已消费的确认水位，不能重复执行确认。");
    return {continuedFrom:parent.discoveryId,options:{target:{discoveryId:parent.discoveryId,contextId:parent.contextId},afterSeq:parent.lastSeq}};
  }
  return {continuedFrom:parent.discoveryId,options:{}};
}
