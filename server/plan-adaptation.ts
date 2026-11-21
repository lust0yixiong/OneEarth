import {validResearchIntent,type ResearchIntent} from '../src/domain/research-intent';
export type PlanningHistory={role:'user'|'assistant';text?:string;message?:string;researchIntent?:ResearchIntent};
export type PlanningContext={conversationContext?:string;previousResearchIntent?:ResearchIntent;history?:PlanningHistory[]};
export function changesTopic(query:string){return /(?:换(?:个|一?个)?话题|换一(?:个|项)研究|改谈|转而研究|new topic|switch topics)/i.test(query);}
export function userTopic(query:string,context:PlanningContext={}){
  if(changesTopic(query))return query;
  const users=(context.history||[]).filter(t=>t.role==='user').map(t=>t.text||t.message||'').filter(Boolean);
  return [context.previousResearchIntent?.purpose,users.slice(-4).join(' '),query].filter(Boolean).join(' ').slice(-7000);
}
/** Recover only closed research-year conditions, not document chronology or open-ended dates. */
export function explicitResearchYears(query:string,context:PlanningContext={}):{time:string;period:[number,number]}|undefined{
  const matches=[...query.matchAll(/\b((?:1|2)\d{3})(?:\s*年)?(?:\s*(?:[—–~至到-]|to)\s*((?:1|2)\d{3})(?:\s*年)?)?/gi)];
  const accepted:Array<{time:string;period:[number,number]}>=[];
  for(const m of matches){
    const index=m.index!,before=query.slice(0,index).split(/[，。；,;!?？!\n]/).at(-1)||'',after=query.slice(index+m[0].length).split(/[，。；,;!?？!\n]/)[0];
    const begin=Number(m[1]),end=Number(m[2]||m[1]);
    if(begin>end||end>2300)continue;
    // A year embedded in a date needs finer parsing, not a falsely exact annual condition.
    if(/^\s*(?:\d{1,2}月|[-/]\d{1,2}(?:[-/]|\b))/.test(after))continue;
    if(/(?:自|从|since)\s*$/i.test(before)||/^\s*(?:以来|起|开始|以后|之后|至今|迄今|以前|之前|前|后)/.test(after))continue;
    if(/^\s*(?:年)?\s*(?:的)?(?:版|版本|发布|发表|出版|成文|编写|上线|修订|发行|更新)/.test(after)
      ||/^\s*(?:edition|version|release|publication|published|revision)\b/i.test(after)
      ||/(?:发布|发表|出版|成文|编写|上线|修订|发行|更新)(?:于|年份(?:为|是)?|时间(?:为|是)?)?\s*$/i.test(before)
      ||/(?:published|released|written|revised)(?: in| on)?\s*$/i.test(before))continue;
    const cue=/(?:研究|观测|采样|采集|测量|分析|筛选|限定|考察|比较|关注|只看|仅看|就看|年份|时段|时期|时间范围|期间|study|observations?|sampling|filter|period|time window)[^，。；,;!?？!\n]{0,35}$/i.test(before)
      ||/^\s*(?:的)?(?:研究|观测|采样|采集|测量|分析|筛选|期间|时段|observations?|samples?)/i.test(after);
    const lastAssistant=(context.history||[]).filter(t=>t.role==='assistant').at(-1);
    const answeringTime=/年份|时段|时期|时间范围|哪年|which years|what period/i.test(lastAssistant?.text||lastAssistant?.message||'')
      &&query.trim().replace(/[。.!！?？]/g,'')===m[0].trim();
    if(cue||answeringTime)accepted.push({time:m[0].trim(),period:[begin,end]});
  }
  const unique=new Map(accepted.map(v=>[v.period.join(':'),v]));
  return unique.size===1?[...unique.values()][0]:undefined;
}
/** An intent can retain an open textual time without inventing a closed filter interval. */
export function closedIntentPeriod(time:string|null|undefined):[number,number]|null{
  if(!time||/(?:以来|至今|迄今|之后|以后|之前|以前|起|最近|近几年|版|发布|发表|出版|成文|since|after|before|onward|edition|version|published)/i.test(time))return null;
  const range=time.match(/\b((?:1|2)\d{3})\s*年?\s*(?:[—–~至到-]|to)\s*((?:1|2)\d{3})/i);
  if(range){const a=Number(range[1]),b=Number(range[2]);return a<=b&&b<=2300?[a,b]:null;}
  const years=[...time.matchAll(/\b((?:1|2)\d{3})\b/g)];
  if(years.length!==1)return null;
  const year=Number(years[0][1]);return year<=2300?[year,year]:null;
}
export function restoredIntent(query:string,context:PlanningContext={}):ResearchIntent{
  const old=!changesTopic(query)&&validResearchIntent(context.previousResearchIntent)?context.previousResearchIntent:undefined;
  const explicit=explicitResearchYears(query,context);
  let time=old?.time||null;
  if(explicit)time=explicit.time;
  if(/(?:不限|不限定|取消|不再限定)(?:研究)?(?:年份|时段|时间)/.test(query))time=null;
  const region=query.match(/(?:研究区|地区|区域|范围)\s*(?:改成|改为|就看|定为|是)\s*([^，。；,;\n]{1,80})/)?.[1];
  const months=/不限月份|不再限定月份/.test(query)?[]:old?.months||[];
  const previousUser=!changesTopic(query)?(context.history||[]).filter(t=>t.role==='user').map(t=>t.text||t.message||'').find(t=>t.length>15):undefined;
  return {purpose:old?.purpose||previousUser?.slice(0,1200)||query.slice(0,1200),task:query.slice(0,1200),region:region&&!/年|月|日/.test(region)?region:old?.region||null,time,months};
}
/** Public topical lookup only: never carry sample measurements, numeric rows, credentials or code into fallback searches. */
export function publicTopic(text:string){
  return text.replace(/https?:\/\/\S+/g,' ').replace(/\b(?:token|password|api[_-]?key)\s*[:=]\s*\S+/gi,' ')
    .replace(/```[\s\S]*?```/g,' ').replace(/[{};=<>]/g,' ').replace(/[-+]?\d+(?:[.,]\d+)*/g,' ').replace(/\s+/g,' ').trim();
}
const englishStop=new Set('i you we it this that the a an and or for to of in on with from is are was were be by as please what which how could can would should need research data dataset datasets information evidence previous same show tell explain'.split(' '));
export function englishPhrases(text:unknown,max=3):string[]{
  if(typeof text!=='string'||text.length>1600||/[{};=<>]|https?:\/\/|\p{Script=Han}/u.test(text))return [];
  const words=text.match(/[A-Za-z][A-Za-z0-9_-]*/g)||[];
  const terms=words.filter(w=>!englishStop.has(w.toLowerCase()));
  if(!terms.length||terms.length>36)return [];
  const phrases=[];for(let i=0;i<terms.length&&phrases.length<max;i+=3)phrases.push(terms.slice(i,i+3).join(' '));
  return phrases;
}
export function topicEnglish(text:string){
  // Extract only actual Latin spans, never manufacture a translation of Chinese research terms.
  return [...new Set((text.match(/[A-Za-z][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*)*/g)||[]).flatMap(s=>englishPhrases(s)))].slice(0,3);
}
const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
const functionWords=new Set('我 你 您 请 先 帮 帮我 想 要 能 可以 能否 是否 如何 怎么 怎样 吗 呢 吧 就 行 有 的 地 得 和 与 且 也 还 来 用 个 一种 具体 候选 明显 可 要有'.split(' '));
function questionTerms(value:string){
  const task=value.split(/[。；;]/).filter(s=>!/^\s*我.*(?:还没|没有|不知道|未选|没选)/.test(s)).join(' ')
    .replace(/选两个/g,'选择两个').replace(/选取/g,'选择').replace(/差别|不同/g,'差异').replace(/核查/g,'核对').replace(/对比/g,'比较').replace(/能找到|找到|要有/g,'有');
  return new Set([...segmenter.segment(task.toLowerCase())].filter(s=>s.isWordLike&&!functionWords.has(s.segment)).map(s=>s.segment));
}
/** Only a tightly bounded paraphrase is exempt. Added names/numbers/negation/causal scope always need confirmation. */
export function equivalentQuestion(original:string,proposed:string){
  if(/先.*(?:改写|转换|提议)|供我(?:确认|选择)/.test(original))return false;
  const a=questionTerms(original),b=questionTerms(proposed);
  if(a.size<3||b.size<3)return original.replace(/[\p{P}\s]/gu,'')===proposed.replace(/[\p{P}\s]/gu,'');
  const sensitive=(s:string)=>(s.match(/\d+|[A-Za-z][A-Za-z0-9_-]*|不(?:能|是|要|同意)|因果|导致|证明|下载|执行|计算/g)||[]).sort().join('|');
  if(sensitive(original)!==sensitive(proposed))return false;
  const shared=[...b].filter(t=>a.has(t)).length;
  return shared/b.size===1&&shared/a.size>=.8;
}
export function clarificationBlockReason(query:string,clarification:string,context:PlanningContext={}){
  if(!/[?？]|(?:哪|什么|是否|能否|请(?:提供|补充|说明|给出|告诉)|还是|更想|想先|多少|多大|吗)/.test(clarification))return 'clarification-is-action-not-question';
  if(/(?:你|助手|系统|本轮|刚才|这次).*(?:实际|究竟|到底|已经|是否).*(?:读|读取|下载|执行|计算|做了|检索)/.test(query)&&/(?:你|您|用户|手头).*(?:有|做|读|下载|执行)|提供|发来/.test(clarification))return 'assistant-execution-question';
  const currentAndUsers=[...(context.history||[]).filter(t=>t.role==='user').slice(-3).map(t=>t.text||t.message||''),query].join(' ');
  if(/(?:一般|通用|原则|通常|方法|要看哪些|哪些资料|不能确定|做不了|什么证据)/.test(query)
    &&/(?:不知道|不清楚|想不起|没有|没选定|未选定|先说说|先讲|一般|通常|通用)/.test(currentAndUsers)
    &&/(?:哪(?:套|份|个|种)|库名|名称|名字|链接|DOI|截图|提供|地点|位置)/i.test(clarification))return 'general-guidance-does-not-require-identity';
  return undefined;
}
