import {Fragment,useEffect,useMemo,type ReactNode} from "react";
import {BookOpen} from "lucide-react";
import {answerBlocks,blockText,type AnswerBlock} from "../domain/answer-blocks";
import {answerTokens,renderAnswerMath,revealAnswerText} from "../domain/answer-math";
import {citationLabel,citationDetails,type CitationDetails} from "../domain/answer-sources";
import {CitationLink} from "./CitationLink";
import type {AnswerReference} from "../domain/types";

const safeUrl=(s:string)=>{try{const u=new URL(s);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:undefined;}catch{return undefined;}};
function AnswerMath({tex,display,raw}:{tex:string;display?:boolean;raw:string}) {
  const html=useMemo(()=>renderAnswerMath(tex,display),[tex,display]);
  return html?<span className={display?"answer-math display":"answer-math"} dangerouslySetInnerHTML={{__html:html}}/>:<code className="answer-math-fallback">{raw}</code>;
}
interface Props {
  quote?:(reference:AnswerReference,number:number)=>void;
  selectedReferences?:AnswerReference[];
  text:string; references:AnswerReference[]; inspect:(id:string)=>void; hover?:(id:string|null)=>void;
  details?:CitationDetails[];
  inCell?:ReadonlySet<string>; focused?:string; limitation?:string; open?:(refs:AnswerReference[])=>void;
  animate?:boolean; onComplete?:()=>void;
}
export function AnswerContent({quote,selectedReferences,text,references,details,inspect,hover,inCell,focused,limitation,open,onComplete}:Props) {
  const blocks=useMemo(()=>answerBlocks(text),[text]);
  // The server returns a fully validated answer, not model token deltas.
  // Display available text and its source actions in the same paint.
  const limit=Infinity;
  useEffect(()=>{onComplete?.();},[text,onComplete]);
  function inline(line:string):ReactNode[] {
    const tokens=answerTokens(line);
    const emphasis=tokens.filter(t=>t.kind==="text").flatMap(t=>[...t.raw.matchAll(/\*\*/g)].map(m=>t.start+m.index));
    if(emphasis.length>=2){
      const [start,end]=emphasis;
      return [<Fragment key="before">{inline(line.slice(0,start))}</Fragment>,<strong key="strong">{inline(line.slice(start+2,end))}</strong>,<Fragment key="after">{inline(line.slice(end+2))}</Fragment>];
    }
    return tokens.map((token,index)=>{
      if(token.kind==="math"){
        return <AnswerMath key={index} tex={token.tex!} display={token.display} raw={token.raw}/>;
      }
      if(token.kind==="code")return <code key={index}>{token.raw.replace(/^(`+)([\s\S]*)\1$/,"$2")}</code>;
      return <Fragment key={index}>{inlineText(token.raw)}</Fragment>;
    });
  }
  function inlineText(line:string):ReactNode[] {
    return line.split(/(〔\d+〕|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part,i,parts)=>{
      const marker=/^〔(\d+)〕$/.exec(part);
      if(marker){
        const ref=references[+marker[1]-1];if(!ref)return part;
        const id=ref.kind==="asset"?ref.id:undefined;
        const label=parts[i-1]?.trimEnd().endsWith(ref.title)?part:citationLabel(ref.title)+part;
        return <CitationLink key={i} reference={ref} number={+marker[1]} label={label} details={details?.[+marker[1]-1] || citationDetails(ref)}
          quote={quote} selected={selectedReferences?.some(r=>r.kind===ref.kind && (r.kind==="asset" && ref.kind==="asset"?r.id===ref.id:r.kind==="web" && ref.kind==="web" && r.url===ref.url))} inspect={inspect} hover={hover} inCell={!!id&&inCell?.has(id)} focused={!!id&&focused===id}/>;
      }
      if(part.startsWith("**")&&part.endsWith("**"))return <strong key={i}>{inline(part.slice(2,-2))}</strong>;
      if(part.startsWith("`")&&part.endsWith("`"))return <code key={i}>{part.slice(1,-1)}</code>;
      const link=/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
      return link&&safeUrl(link[2])?<a key={i} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>:part;
    });
  }
  function sourceButton(raw:string) {
    const prose=answerTokens(raw).filter(t=>t.kind==="text").map(t=>t.raw).join("");
    const group=[...new Set([...prose.matchAll(/〔(\d+)〕/g)].map(m=>references[+m[1]-1]).filter(Boolean))];
    return group.length&&open?<button className="oe-block-sources" onClick={()=>open(group)}><BookOpen size={11}/>本段依据 {group.length}</button>:null;
  }
  function render(b:AnswerBlock,available:number) {
    if(b.kind==="table")return <div className="answer-table"><table data-columns={b.rows[0].length}><thead><tr>{b.rows[0].map((c,i)=><th key={i} scope="col">{inline(c)}</th>)}</tr></thead><tbody>{b.rows.slice(1).map((row,r)=><tr key={r}>{b.rows[0].map((_,i)=><td key={i} style={{textAlign:b.align[i]}}>{inline(row[i]||"")}</td>)}</tr>)}</tbody></table></div>;
    if(b.kind==="list"){const items=b.items.map((s,i)=><li key={i}>{inline(s)}</li>);return b.start===undefined?<ul>{items}</ul>:<ol start={b.start}>{items}</ol>;}
    if(b.kind==="code")return <pre><code>{b.text}</code></pre>;
    if(b.kind==="heading")return <h3>{inline(b.text)}</h3>;
    return <p>{inline(revealAnswerText(b.text,available))}</p>;
  }
  const lead=Math.max(0,blocks.findIndex(b=>b.kind!=="heading"));
  let offset=0;
  return <div className="answer-prose">{blocks.map((b,i)=>{
    const available=limit-offset,raw=blockText(b);offset+=raw.length;
    if(available<=0)return null;
    return <Fragment key={i}><div className={i===lead && b.kind==="paragraph"?"oe-answer-lead":"oe-answer-block"}>{render(b,available)}{b.kind!=="code" && available>=raw.length && sourceButton(raw)}</div>
      {i===lead && limitation && available>=raw.length && <aside className="oe-limitation"><h4>适用范围与限制</h4><p>{inline(limitation)}</p>{sourceButton(limitation)}</aside>}</Fragment>;
  })}</div>;
}
