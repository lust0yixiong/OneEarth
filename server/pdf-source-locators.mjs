import {boundedLocatorIndex,documentText,hasLocatorMarker,locatorIdentifier,matchesLocatorLabel} from "./locator-labels.mjs";

// PDF text order is not a table model. Use coordinates only when the same columns align on each row.
function linesFrom(items){
  const lines=[];
  for(const item of items.slice(0,12000)){
    if(typeof item.str!=="string"||!item.str.trim()||!Array.isArray(item.transform))continue;
    const x=item.transform[4],y=item.transform[5];
    if(!Number.isFinite(x)||!Number.isFinite(y))continue;
    let line=lines.find(row=>Math.abs(row.y-y)<=1.5);
    if(!line){line={y,items:[]};lines.push(line);}
    line.items.push({text:documentText(item.str.slice(0,2000)),x,width:item.width||0});
  }
  return lines.sort((a,b)=>b.y-a.y).map(line=>{
    const cells=[];
    for(const part of line.items.sort((a,b)=>a.x-b.x)){
      const previous=cells.at(-1);
      if(previous&&part.x<previous.end+12){
        previous.text+=" "+part.text;previous.end=Math.max(previous.end,part.x+part.width);
      }else cells.push({text:part.text,x:part.x,end:part.x+part.width});
    }
    return {cells,text:cells.map(cell=>cell.text).join(" ")};
  });
}

function tableBelow(lines,index){
  const header=lines[index+1]?.cells;
  if(!header||header.length<2||header.length>12||header.some(c=>c.text.length>200))return [];
  const rows=[];
  for(const line of lines.slice(index+2,index+14)){
    if(line.cells.length!==header.length||line.cells.some((cell,i)=>Math.abs(cell.x-header[i].x)>5||cell.text.length>200))break;
    rows.push(line.cells.map(cell=>cell.text));
  }
  if(!rows.length)return [];
  return [JSON.stringify({kind:"header",cells:header.map(cell=>cell.text)}),
    ...rows.map(cells=>JSON.stringify({kind:"row",cells}))];
}

export function createPdfLocatorCollector(locators,numPages){
  const checkedPages=[],available=new Map(),located=new Map();
  function remember(entry){
    const key=entry.kind+"\0"+entry.value;
    if(!available.has(key)&&available.size<240)available.set(key,entry);
  }
  function record(entry,match,status,text){
    remember(entry);
    for(const [index,locator] of locators.entries()){
      if(locator.kind!==entry.kind||!match(locator.value))continue;
      const old=located.get(index);
      if(old&&(old.status==="found"||status==="partial"&&(old.text?.length||0)>=(text?.length||0)))continue;
      located.set(index,{...locator,label:entry.label,pageNo:entry.pageNo,status,text});
    }
  }
  return {
    addPage(pageNo,items){
      checkedPages.push(pageNo);
      const lines=linesFrom(items),text=lines.map(line=>line.text).join("\n").trim();
      record({kind:"page",value:String(pageNo),label:"PDF page "+pageNo,pageNo},value=>Number(value)===pageNo,
        text&&text.length<=3200&&items.length<=12000&&(!items.some(item=>item.str?.length>2000))?"found":"partial",text.slice(0,3200));
      for(const [index,line] of lines.entries()){
        if(!line.text||line.text.length>400)continue;
        for(const kind of ["table","figure"]){
          const value=locatorIdentifier(kind,line.text,true);
          if(!value||!hasLocatorMarker(kind,line.text))continue;
          if(/^(?:table|figure|fig\.?)\s+[a-z]?\d+\s+(?:shows?|presents?|illustrates?|lists?|summari[sz]es?)\b/i.test(line.text))continue;
          const rows=kind==="table"?tableBelow(lines,index):[];
          const label=line.text.slice(0,240);
          record({kind,value,label,pageNo},wanted=>matchesLocatorLabel(kind,wanted,label),"partial",
            [label,...rows].join("\n"));
        }
        const equation=line.text.match(/^(.{2,350}?)\s+\(([A-Z]?\d+(?:\.\d+)*)\)$/i);
        if(equation&&/[=+−×∑∫]/.test(equation[1])){
          const value=equation[2],label="Equation "+value;
          record({kind:"equation",value,label,pageNo},wanted=>matchesLocatorLabel("equation",wanted,label),"partial",line.text);
        }
        const heading=line.text.match(/^(?:(?:\d+(?:\.\d+)*|[IVXLCDM]+(?:-[A-Z])?)\.?\s+|(?:Appendix|Section)\s+[A-Z0-9.]+\s*)([\p{L}][^.!?;]{1,100})$/iu);
        const named=locators.some(locator=>locator.kind==="section"&&matchesLocatorLabel("section",locator.value,line.text));
        const commonHeading=/^(?:abstract|introduction|materials and methods|methods|results|discussion|conclusions?|references|摘要|引言|材料与方法|结果|讨论|结论)$/i.test(line.text);
        if(heading||commonHeading||named){
          const label=line.text.slice(0,120),value=locatorIdentifier("section",label,true)||label;
          const part=[];
          for(const next of lines.slice(index+1,index+13)){
            if(/^\d+(?:\.\d+)*\.?\s+[\p{L}]/u.test(next.text))break;
            if(next.text)part.push(next.text);
          }
          const body=part.join("\n").slice(0,1800);
          record({kind:"section",value,label,pageNo},wanted=>matchesLocatorLabel("section",wanted,label),"partial",body);
        }
      }
    },
    result(){
      const ordered=locators.map((locator,index)=>located.get(index)||{...locator,status:"not_found"});
      const excerpts=ordered.flatMap(({text,kind,value,pageNo})=>text?
        ["["+kind+" "+value+" · PDF 第 "+pageNo+" 页]\n"+text]:[]);
      return {excerpt:excerpts.length?excerpts.join("\n\n")+"\n[检查范围] 实际检查 PDF 物理页 "+
        checkedPages.join(", ")+"；文档共 "+numPages+" 页。图像图表仅保留可读题注，行列未核实时不报告数值。":undefined,
        results:ordered.map(({text,...entry})=>({...entry,...(text?{excerpt:text.slice(0,4600)}:{})})),available:boundedLocatorIndex([...available.values()])};
    },
  };
}
