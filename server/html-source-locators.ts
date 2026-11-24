import type {Cheerio} from "cheerio";
import type {AnyNode,Element} from "domhandler";
import type {WebHit} from "../src/domain/types";
import {locatorHref,parseSourceReadLocator,type AvailableSourceLocator,type SourceReadLocator,type SourceReadLocatorResult} from "../src/domain/source-read-locator";
import {boundedLocatorIndex,documentText,hasLocatorMarker,locatorIdentifier,matchesLocatorLabel} from "./locator-labels.mjs";

type Located = AvailableSourceLocator & {anchor?:string;aliases?:string[];content:()=>{text?:string;complete:boolean}};
const heads="h1,h2,h3,h4,h5,h6";
const captionSelector="caption,figcaption,[class*=caption],[role=caption]";
const localName=(node:Element)=>node.name.split(":").at(-1);
const clean=(node:Cheerio<AnyNode>)=>documentText(node.text());
function tableCells(table:Cheerio<AnyNode>,wrap:(node:Element)=>Cheerio<AnyNode>){
  const rows=table.find("tr").toArray().filter(row=>wrap(row).closest("table").get(0)===table.get(0));
  let complete=rows.length<=36,remaining=4000;
  const parsed=[];
  for(const row of rows.slice(0,36)){
    const cells=wrap(row).children("th,td").toArray();
    if(!cells.length)continue;
    if(cells.length>16)complete=false;
    const values=cells.slice(0,16).map(cell=>{
      const node=wrap(cell),text=clean(node),value=text.slice(0,320);
      if(text.length>value.length)complete=false;
      const span=Object.fromEntries(["colspan","rowspan"].flatMap(key=>{
        const n=Number(node.attr(key));return Number.isSafeInteger(n)&&n>1?[[key,n]]:[];
      }));
      return Object.keys(span).length?{value,...span}:value;
    });
    const line=JSON.stringify({kind:cells.every(cell=>cell.name==="th")||wrap(row).parents("thead").length?"header":"row",cells:values});
    remaining-=line.length;
    if(remaining<0){complete=false;break;}
    parsed.push(line);
  }
  return {text:parsed.length?parsed.join("\n"):undefined,complete:complete&&parsed.length>0};
}

export function locateHtmlSource(hit:WebHit,root:Cheerio<AnyNode>,wrap:(node:Element)=>Cheerio<AnyNode>,
  locators:SourceReadLocator[],truncated:boolean):WebHit{
  const entries:Located[]=[];
  function add(kind:SourceReadLocator["kind"],label:string,anchor:string|undefined,content:Located["content"],aliases:string[]=[]){
    label=documentText(label).slice(0,240);
    const value=[label,anchor||"",...aliases].map(text=>locatorIdentifier(kind,text,true)).find(Boolean)||label.slice(0,120);
    if(!parseSourceReadLocator({kind,value}))return false;
    entries.push({kind,value,label,anchor,aliases,href:locatorHref(hit.url,anchor),content});
    return true;
  }
  function anchor(node:Cheerio<AnyNode>){
    return node.attr("id")||node.children("[id]").first().attr("id")||node.closest("section[id],sec[id],table-wrap[id],fig[id],disp-formula[id],figure[id],[role=table][id],div[id]").attr("id");
  }
  const blocks=root.find(heads+",sec > title,p,li,pre").toArray();
  for(const [index,block] of blocks.entries()){
    const node=wrap(block);
    if(block.name==="title"){
      const section=node.parent(),label=clean(section.children("label").first());
      add("section",[label,clean(node)].filter(Boolean).join(" "),anchor(node),()=>{
        const text=section.find("p").map((_,p)=>clean(wrap(p))).get().filter(Boolean).join("\n");
        return {text:text.slice(0,3200),complete:!!text&&text.length<=3200};
      });
      continue;
    }
    if(!/^h[1-6]$/.test(block.name))continue;
    const level=Number(block.name[1]);
    add("section",clean(node),anchor(node),()=>{
      const parts=[];let total=0;
      for(const next of blocks.slice(index+1)){
        if(/^h[1-6]$/.test(next.name)&&Number(next.name[1])<=level)break;
        const text=clean(wrap(next));
        total+=text.length;
        if(total>3200)return {text:[...parts,text.slice(0,Math.max(0,3200-total+text.length))].join("\n"),complete:false};
        if(text)parts.push(text);
      }
      return {text:parts.join("\n"),complete:parts.length>0};
    });
  }
  const coveredTables=new Set<Element>(), headings=entries.length;
  root.find("table,table-wrap,figure,fig,[role=table],math,disp-formula,[id]").each((_,element)=>{
    if(entries.length-headings>=400)return false;
    if(coveredTables.has(element))return;
    const node=wrap(element),id=node.attr("id")||"";
    const table=element.name==="table"?node:node.find("table").first();
    const mark=clean(node.children("label").first());
    const rawCaption=clean(node.children(captionSelector).first())||
      (element.name==="table-wrap"?clean(table.children("caption").first()):"")||
      clean(node.parent().children(captionSelector).first());
    const caption=rawCaption.slice(0,500);
    const label=[mark,caption].filter(Boolean).join(" ")||node.attr("aria-label")||id;
    const tableIdentity=hasLocatorMarker("table",label)||hasLocatorMarker("table",id);
    const figureIdentity=hasLocatorMarker("figure",label)||hasLocatorMarker("figure",id);
    const equationIdentity=hasLocatorMarker("equation",label)||hasLocatorMarker("equation",id);
    if(["table","table-wrap"].includes(element.name)||node.attr("role")==="table"||tableIdentity){
      if(element.name==="table" && node.parents("figure,[role=table]").toArray().some(parent=>
        !!locatorIdentifier("table",clean(wrap(parent).children(captionSelector).first())||wrap(parent).attr("id")||"",true)))return;
      const inner=table.get(0);
      const tableLabel=label||(element.name==="table-wrap"?clean(table.children("caption").first())||table.attr("id")||"":"");
      const innerId=table.attr("id");
      const accepted=add("table",tableLabel,anchor(node)||innerId,()=>{
        const values=tableCells(table,wrap);
        return {text:[caption,values.text].filter(Boolean).join("\n"),complete:values.complete&&rawCaption.length<=500};
      },element.name==="table-wrap"&&innerId?[innerId]:[]);
      if(element.name==="table-wrap"&&inner?.type==="tag"&&accepted)coveredTables.add(inner);
    }else if(["figure","fig"].includes(element.name)||figureIdentity){
      add("figure",label,anchor(node),()=>({text:caption,complete:false}));
    }else if(["math","disp-formula"].includes(element.name)||equationIdentity){
      const math=localName(element)==="math"?node:node.find("*").filter((_,child)=>localName(child)==="math").first();
      if(!equationIdentity&&math.parents("[id]").toArray().some(parent=>locatorIdentifier("equation",wrap(parent).attr("id")||"",true)))return;
      add("equation",label,anchor(node),()=>{
        const tex=math.find("*").filter((_,child)=>localName(child)==="annotation"&&wrap(child).attr("encoding")==="application/x-tex").first();
        const encoded=clean(node.find("tex-math").first())||clean(tex)||math.attr("alttext");
        const native=math.clone();
        native.find("*").filter((_,child)=>localName(child)==="annotation-xml").remove();
        const text=encoded||(native.children().length?native.toString():undefined);
        return {text:text?.length&&text.length<=4000?text:undefined,complete:!!text&&text.length<=4000};
      });
    }
  });
  const availableLocators=boundedLocatorIndex(entries).map(({kind,value,label,href})=>({kind,value,label,href}));
  const excerpts:string[]=[];
  const locatorResults=locators.map((locator):SourceReadLocatorResult=>{
    if(locator.kind==="page")return {...locator,status:"unsupported"};
    const matching=entries.filter(item=>item.kind===locator.kind&&matchesLocatorLabel(item.kind,locator.value,item.label||"",item.anchor||"",...(item.aliases||[])));
    // Where different elements share a label, prefer the one with actual extractable content.
    const found=matching.map(item=>({item,...item.content()})).sort((a,b)=>Number(b.complete)-Number(a.complete)||
      (b.text?.length||0)-(a.text?.length||0))[0];
    if(!found)return {...locator,status:"not_found"};
    if(found.text)excerpts.push("["+locator.kind+" "+locator.value+" · "+found.item.label+"]\n"+found.text);
    return {...locator,label:found.item.label,href:found.item.href,status:found.complete&&!truncated?"found":"partial",
      ...(found.text?{excerpt:found.text}:{})};
  });
  return {...hit,...(locators.length?{locatorResults}:{}),availableLocators,...(excerpts.length?{pageExcerpt:excerpts.join("\n\n")}:{})};
}
