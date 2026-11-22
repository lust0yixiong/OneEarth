import { request } from "node:http";
import type { RequestHandler } from "express";

export function spatialProxy(base: string, options: { timeout?: number; authorization?: boolean } = {}): RequestHandler {
  return (req,res) => {
    const url=new URL(req.originalUrl,base);
    const headers:Record<string,string>={};
    if (req.get("if-none-match")) headers["if-none-match"]=req.get("if-none-match")!;
    if (req.get("accept-encoding")) headers["accept-encoding"]=req.get("accept-encoding")!;
    if (req.get("content-type")) headers["content-type"]=req.get("content-type")!;
    if (req.get("content-length")) headers["content-length"]=req.get("content-length")!;
    if (options.authorization && req.get("authorization")) headers.authorization=req.get("authorization")!;
    const upstream=request(url,{method:req.method,headers,timeout:options.timeout ?? 20000}, response=>{
      res.status(response.statusCode || 502);
      for(const name of ["etag","content-type","content-length","cache-control","x-oneearth-service","content-encoding","content-disposition","x-content-type-options","x-accel-buffering","vary"]) {
        const value=response.headers[name];
        if(value)res.setHeader(name,value);
      }
      response.pipe(res);
    });
    upstream.on("timeout",()=>upstream.destroy());
    upstream.on("error",()=>{
      if(res.headersSent)res.destroy();
      else res.status(502).json({error:"业务服务暂时无法连接。"});
    });
    res.on("close",()=>upstream.destroy());
    if(req.method==="POST" || req.method==="PUT")req.pipe(upstream);
    else upstream.end();
  };
}
