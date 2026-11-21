import {renderToString} from "katex";

export type AnswerToken={kind:"text"|"code"|"math";raw:string;start:number;tex?:string;display?:boolean};
const escaped=(text:string,i:number)=>{let n=0;while(i>0 && text[--i]==="\\")n++;return n%2===1;};

/** Explicit TeX delimiters only: dollars, paths and code are not mathematics. */
export function answerTokens(text:string):AnswerToken[] {
  const tokens:AnswerToken[]=[];let start=0,i=0;
  const push=(kind:AnswerToken["kind"],end:number,extra:Partial<AnswerToken>={})=>{
    if(i>start)tokens.push({kind:"text",raw:text.slice(start,i),start});
    tokens.push({kind,raw:text.slice(i,end),start:i,...extra});i=end;start=end;
  };
  while(i<text.length){
    if((text[i]==="`" || text[i]==="~") && /^ {0,3}$/.test(text.slice(text.lastIndexOf("\n",i-1)+1,i))){
      const fence=/^(`{3,}|~{3,})/.exec(text.slice(i));
      if(fence){
        const closing=new RegExp("^ {0,3}"+fence[0][0]+"{"+fence[0].length+",}[ \\t]*(?=\\n|$)","gm");
        closing.lastIndex=i+fence[0].length;
        const end=closing.exec(text);push("code",end?end.index+end[0].length:text.length);continue;
      }
    }
    if(text[i]==="`" && !escaped(text,i)){
      const ticks=/^`+/.exec(text.slice(i))![0],end=text.indexOf(ticks,i+ticks.length);
      if(end>=0){push("code",end+ticks.length);continue;}
      if(ticks.length>=3){push("code",text.length);continue;}
    }
    if(text[i]==="\\" && !escaped(text,i) && (text[i+1]==="(" || text[i+1]==="[")){
      const display=text[i+1]==="[",close=display?"\\]":"\\)";let end=i+2;
      while((end=text.indexOf(close,end))>=0 && escaped(text,end))end+=2;
      if(end>=0){push("math",end+2,{tex:text.slice(i+2,end),display});continue;}
    }
    i++;
  }
  if(start<text.length)tokens.push({kind:"text",raw:text.slice(start),start});
  return tokens;
}

/** Decode malformed prose separators only before Markdown structure. */
export function normalizeAnswerNewlines(text:string):string {
  return answerTokens(text).map(token=>token.kind!=="text"?token.raw:token.raw.replace(/\\n(?=\s*(?:\d+[.)]\s|[-*+]\s|#{1,6}\s|\\n))/g,(raw,offset:number,source:string)=>{
    if(escaped(source,offset))return raw;
    const word=source.slice(0,offset).match(/\S*$/)?.[0] || "";
    if(/^(?:[A-Za-z]:(?:[\\/]|$)|(?:https?|file):\/\/|[.~]?[\\/]|[\w.-]+[\\/])/.test(word) || /^[\w.-]+$/.test(word))return raw;
    return "\n";
  })).join("");
}

/** Prose line boundaries must not cut a multi-line mathematical expression. */
export function answerLines(text:string):string[] {
  const lines=[""];
  for(const token of answerTokens(normalizeAnswerNewlines(text.replace(/\r\n?/g,"\n")))){
    const parts=token.kind==="math"?[token.raw]:token.raw.split("\n");
    lines[lines.length-1]+=parts[0];lines.push(...parts.slice(1));
  }
  return lines;
}

/** Reveal an expression atomically, never feed partial TeX to the renderer. */
export function revealAnswerText(text:string,available:number):string {
  let end=Math.max(0,Math.floor(available));
  for(const token of answerTokens(text))if(token.kind==="math" && end>token.start && end<token.start+token.raw.length){end=token.start+token.raw.length;break;}
  return text.slice(0,end);
}

export function renderAnswerMath(tex:string,display=false):string|null {
  if(tex.length>12000)return null;
  try{return renderToString(tex,{displayMode:display,trust:false,throwOnError:true,strict:"ignore",maxSize:10,maxExpand:1000,macros:{},output:"htmlAndMathml"});}
  catch{return null;}
}
