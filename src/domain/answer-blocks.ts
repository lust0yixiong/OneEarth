import {answerLines,answerTokens} from "./answer-math";
export type AnswerBlock =
  | {kind:"paragraph"|"heading"|"code"; text:string}
  | {kind:"list"; items:string[]; start?:number}
  | {kind:"table"; rows:string[][]; align:("left"|"center"|"right")[]};

const list = /^(\d+[.)]|[-*+])\s+(.+)$/;
const divider = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const cells = (line:string) => {
  const result=[""];
  for(const token of answerTokens(line.trim().replace(/^\||\|$/g,""))){
    const parts=token.kind==="text"?token.raw.split(/(?<!\\)\|/).map(s=>s.replace(/\\\|/g,"|")):[token.raw];
    result[result.length-1]+=parts[0];result.push(...parts.slice(1));
  }
  return result.map(s=>s.trim());
};

export function answerBlocks(text:string):AnswerBlock[] {
  const lines=answerLines(text), blocks:AnswerBlock[]=[];
  for(let i=0;i<lines.length;) {
    const line=lines[i++].trim();
    if(!line) continue;
    if(/^(?:`{3,}|~{3,})/.test(line)) {
      const fence=/^(`{3,}|~{3,})/.exec(line)![0];
      const code:string[]=[];
      while(i<lines.length && !lines[i].trim().startsWith(fence)) code.push(lines[i++]);
      i++; blocks.push({kind:"code",text:code.join("\n")});
    } else if(line.includes("|") && divider.test(lines[i] || "")) {
      const rows=[cells(line)], align=cells(lines[i++]).map(s=>s.endsWith(":") ? s.startsWith(":")?"center":"right":"left");
      while(i<lines.length && lines[i].includes("|")) rows.push(cells(lines[i++]));
      blocks.push({kind:"table",rows,align});
    } else if(/^#{1,6}\s/.test(line)) {
      blocks.push({kind:"heading",text:line.replace(/^#{1,6}\s+/,"")});
    } else if(list.test(line)) {
      const ordered=/^\d/.test(line), items=[line.match(list)![2]];
      while(i<lines.length) {
        const next=lines[i].trim(), match=next.match(list);
        if(!match || /^\d/.test(next)!==ordered) break;
        items.push(match[2]);i++;
      }
      blocks.push({kind:"list",items,start:ordered?parseInt(line):undefined});
    } else blocks.push({kind:"paragraph",text:line});
  }
  return blocks;
}
export function blockText(b:AnswerBlock) {
  return b.kind==="table"?b.rows.flat().join("\n"):b.kind==="list"?b.items.join("\n"):b.text;
}
