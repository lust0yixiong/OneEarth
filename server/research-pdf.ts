import {literatureText} from "../src/domain/literature-label";
import express from "express";
import {chromium} from "playwright-core";
import {existsSync} from "node:fs";
import {answerBlocks} from "../src/domain/answer-blocks";

const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
function inline(raw:string) {
  return escape(literatureText(raw)).replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/`([^`]+)`/g,"<code>$1</code>");
}
export function researchPdf() {
  const router=express.Router();
  router.post("/",express.json({limit:"2mb"}),async(req,res)=>{
    const {question,answer,limitation="",references=[],finished}=req.body||{};
    if(typeof question!=="string"||typeof answer!=="string"||!answer.trim()||typeof limitation!=="string"||
      !Array.isArray(references)||!references.every(s=>typeof s==="string")||!Number.isFinite(finished)){
      res.status(400).json({error:"研究记录内容不完整。"});return;
    }
    const path=process.env.CHROME_PATH || (process.platform==="darwin"?"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":"/usr/bin/chromium");
    const browser=await chromium.launch({executablePath:existsSync(path)?path:undefined,headless:true});
    try {
      const page=await browser.newPage({javaScriptEnabled:false});
      const blocks=answerBlocks(answer).map(b=>{
        if(b.kind==="table")return "<table><thead><tr>"+b.rows[0].map(c=>"<th>"+inline(c)+"</th>").join("")+"</tr></thead><tbody>"+b.rows.slice(1).map(row=>"<tr>"+row.map(c=>"<td>"+inline(c)+"</td>").join("")+"</tr>").join("")+"</tbody></table>";
        if(b.kind==="list"){const tag=b.start===undefined?"ul":"ol";return "<"+tag+(b.start===undefined?"":" start='"+b.start+"'")+">"+b.items.map(s=>"<li>"+inline(s)+"</li>").join("")+"</"+tag+">";}
        const tag=b.kind==="heading"?"h2":b.kind==="code"?"pre":"p";
        return "<"+tag+">"+inline(b.text)+"</"+tag+">";
      });
      await page.setContent('<meta charset="utf-8"><style>body{font:11pt/1.65 "PingFang SC","Noto Sans CJK SC",sans-serif;color:#213b32;overflow-wrap:anywhere}header{color:#427060;border-bottom:1px solid #bbcec4;padding-bottom:8px}h1{font-size:19pt}h2{font-size:14pt;break-after:avoid}p,li{orphans:2;widows:2}table{width:100%;border-collapse:collapse;font-size:10pt}th,td{border:1px solid #cedbd4;text-align:left;padding:5px}th{background:#eff5f1}tr{break-inside:avoid}pre{white-space:pre-wrap}small{color:#527064}</style><header>OneEarth · 研究记录</header><h1>'+escape(question)+'</h1><small>'+escape(new Date(finished).toLocaleString("zh-CN"))+'</small>'+blocks.join("")+(limitation?"<h2>适用范围与限制</h2><p>"+inline(limitation)+"</p>":"")+(references.length?"<h2>来源与依据</h2><ol>"+references.map(s=>"<li>"+escape(literatureText(s))+"</li>").join("")+"</ol>":""));
      const pdf=await page.pdf({format:"A4",printBackground:true,margin:{top:"18mm",bottom:"20mm",left:"18mm",right:"18mm"},displayHeaderFooter:true,headerTemplate:"<span></span>",footerTemplate:'<div style="width:100%;text-align:center;font-size:9px;color:#60776b"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
      res.set("Cache-Control","no-store").type("application/pdf").send(pdf);
    } finally {await browser.close();}
  });
  return router;
}
