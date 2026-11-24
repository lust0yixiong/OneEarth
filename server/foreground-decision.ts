import type {TurnInput} from "./turn-planning";

const object=(properties:Record<string,unknown>)=>({type:"object",additionalProperties:false,required:Object.keys(properties),properties});
const kind=(value:string)=>({type:"string",enum:[value]});
const targets={type:"array",maxItems:8,items:{type:"string",maxLength:2300}};
const question={type:"string",minLength:1,maxLength:500};
const choices={type:["array","null"],minItems:2,maxItems:4,items:{type:"string",minLength:1,maxLength:100}};

/** The model expresses one intent, never a platform authorization or parent ID. */
export function foregroundDecisionSchema(actions:{anyOf:unknown[]},observationAvailable=false){
  const controls=actions.anyOf.filter((branch:any)=>["set-control","resolve-control","resolve-published-date"].includes(branch?.properties?.kind?.enum?.[0]));
  const operations=actions.anyOf.filter((branch:any)=>branch?.type!=="null");
  return {anyOf:[
    object({kind:kind("respond"),reply:{type:["string","null"],maxLength:8000},targets}),
    object({kind:kind("read"),targets:{...targets,minItems:observationAvailable?0:1,maxItems:3}}),
    object({kind:kind("search"),goal:{type:"string",minLength:1,maxLength:1200},targets}),
    object({kind:kind("workspace"),action:{anyOf:operations}}),
    object({kind:kind("clarify"),subject:{type:"string",enum:["question","workspace"]},question,choices}),
    object({kind:kind("propose-workspace"),question,action:{anyOf:controls}}),
  ]};
}

function exact(value:any,keys:string[]){
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==keys.length||
    Object.keys(value).some(key=>!keys.includes(key)))throw Error("前台决定分支含缺失或互相冲突字段。");
}
const text=(v:unknown,max:number):v is string=>typeof v==="string"&&!!v.trim()&&v.length<=max&&!v.includes("\0");

/** Also validates plain-JSON model providers that cannot enforce the schema. */
export function normalizeForegroundDecision(raw:string,input:TurnInput){
  const value=JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi,""));
  const keys=["decide",...(input.observationAvailable||input.observationUnavailable?["observationUse"]:[]),
    ...(input.gridCoverage?.status==="ready"&&input.gridCoverage.summary?["gridIntent"]:[])];
  exact(value,keys);
  const d=value.decide;
  if(!d||typeof d!=="object"||Array.isArray(d))throw Error("前台决定需要唯一明确分支。");
  let action=d.kind,goal=input.confirmedQuestion||input.question,targets:string[]=[],reply:string|null=null,
    clarification:string|null=null,workspaceAction:any=null,clarificationSubject:string|undefined,clarificationChoices:string[]|null=null;
  switch(d.kind){
    case "respond":exact(d,["kind","reply","targets"]);if(d.reply!==null&&!text(d.reply,8000))throw Error("答复文字无效。");reply=d.reply;targets=d.targets;break;
    case "read":exact(d,["kind","targets"]);targets=d.targets;break;
    case "search":exact(d,["kind","goal","targets"]);if(!text(d.goal,1200))throw Error("新证据需要独立研究目的。");goal=d.goal.trim();targets=d.targets;break;
    case "workspace":exact(d,["kind","action"]);workspaceAction=d.action;break;
    case "clarify":
      exact(d,["kind","subject","question","choices"]);
      if(!["question","workspace"].includes(d.subject))throw Error("追问需说明是问题条件还是工作台对象。");
      clarification=d.question;clarificationSubject=d.subject;clarificationChoices=d.choices;
      if(d.choices!==null&&(!Array.isArray(d.choices)||d.choices.length<2||d.choices.length>4||!d.choices.every((v:unknown)=>text(v,100))||
        new Set(d.choices.map((v:string)=>v.trim().normalize("NFKC").toLowerCase())).size!==d.choices.length))throw Error("追问选项无效。");
      break;
    case "propose-workspace":
      exact(d,["kind","question","action"]);action="clarify";clarification=d.question;clarificationSubject="proposal";workspaceAction=d.action;
      if(!["set-control","resolve-control","resolve-published-date"].includes(d.action?.kind))throw Error("待确认提案必须是确切控件目标。");
      break;
    default:throw Error("前台决定分支无效。");
  }
  if((d.kind==="clarify"||d.kind==="propose-workspace")&&!text(clarification,500))throw Error("追问缺少有效问题。");
  if((d.kind==="workspace"||d.kind==="propose-workspace")&&(!workspaceAction||typeof workspaceAction!=="object"||Array.isArray(workspaceAction)))throw Error("界面操作需要确切动作。");
  if(!Array.isArray(targets)||targets.length>8||!targets.every(v=>text(v,2300)))throw Error("依据目标列表无效。");
  if(d.kind==="read"&&(!targets.length&&!(input.observationAvailable&&value.observationUse==="selected")||targets.length>3))throw Error("读取需要确切目标或已核观测资料。");
  const grid=input.context.attachedScope?.find(item=>item.kind==="grid"),time=input.context.attachedScope?.find(item=>item.kind==="time");
  return JSON.stringify({action,goal,targets,clarification,clarificationChoices,clarificationSubject,workspaceAction,reply,
    observationUse:value.observationUse,gridIntent:value.gridIntent,
    evidenceNeed:({respond:targets.length?"existing":"none",workspace:"none",read:"read",search:"discover",clarify:"unclear"} as Record<string,string>)[action],
    reason:"前台模型依据本轮意图及已提供对象选择唯一决定。",researchIntent:{purpose:goal,task:goal,region:grid?.place??null,time:time?time.period.join("—")+"年":null,months:[]},
    conversationContext:goal,evidenceGap:action==="search"?goal:null});
}
