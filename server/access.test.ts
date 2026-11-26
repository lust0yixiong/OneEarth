import assert from "node:assert/strict";
import test from "node:test";
import type {Request, Response} from "express";
import type {NetworkInterfaceInfoIPv4} from "node:os";
import {accessGuard, ipv4LoopbackOnly, workbenchLan, type WorkbenchLan} from "./access";

const entry:NetworkInterfaceInfoIPv4={
  address:"10.23.48.143",netmask:"255.255.248.0",family:"IPv4",cidr:"10.23.48.143/21",mac:"",internal:false,
};
const lan=workbenchLan("en1",{en1:[entry]});
assert.ok(lan);

function allowed(socket:{localAddress:string;remoteAddress:string},headers:Record<string,string>,network?:WorkbenchLan) {
  const req={protocol:"http",socket,get:(name:string)=>headers[name]} as unknown as Request;
  let status=200;
  const res={status:(code:number)=>{status=code;return res;},json:()=>{}} as unknown as Response;
  accessGuard("oneearth.example",network)(req,res,()=>{});
  return status;
}

test("internal service routes accept only direct IPv4 loopback traffic outside browser requests", () => {
  const local = {localAddress:"127.0.0.1",remoteAddress:"127.0.0.1"};
  const status = (socket:typeof local, headers:Record<string,string> = {}) => {
    let code = 200;
    const req = {socket,get:(name:string)=>headers[name]} as unknown as Request;
    const res = {status:(value:number)=>{code=value;return res;},json:()=>{}} as unknown as Response;
    ipv4LoopbackOnly(req,res,()=>{});
    return code;
  };
  assert.equal(status(local),200);
  assert.equal(status(local,{origin:"http://127.0.0.1:5474"}),404);
  assert.equal(status(local,{"sec-fetch-site":"same-origin"}),404);
  assert.equal(status({localAddress:entry.address,remoteAddress:local.remoteAddress},
    {"x-forwarded-for":"127.0.0.1"}),404);
  assert.equal(status({...local,remoteAddress:entry.address}),404);
});

test("only a selected interface with one private IPv4 has an optional LAN entry",()=>{
  assert.equal(workbenchLan(undefined,{en1:[entry]}),undefined);
  assert.equal(workbenchLan("en2",{en1:[entry]}),undefined);
  assert.equal(workbenchLan("en1",{en1:[entry,{...entry,address:"10.23.48.145"}]}),undefined);
  assert.equal(workbenchLan("en1",{en1:[{...entry,address:"203.0.113.9",cidr:"203.0.113.9/24"}]}),undefined);
  assert.equal(workbenchLan("en1",{en1:[{...entry,cidr:null}]}),undefined);
});

test("local Host and same-origin checks retain their existing behavior",()=>{
  const socket={localAddress:"127.0.0.1",remoteAddress:"127.0.0.1"};
  assert.equal(allowed(socket,{host:"localhost:5474",origin:"http://localhost:5474"},lan),200);
  assert.equal(allowed(socket,{host:"oneearth.example:5474"},lan),200);
  assert.equal(allowed(socket,{host:"10.23.48.143:5474"},lan),403);
  assert.equal(allowed(socket,{host:"localhost:5474",origin:"http://different.example"},lan),403);
});

test("the LAN socket requires its own address, same origin and a direct source in its network",()=>{
  const localAddress=entry.address;
  const source={localAddress,remoteAddress:"10.23.55.249"};
  const host=entry.address+":5474";
  assert.equal(allowed(source,{host,origin:"http://"+host},lan),200);
  assert.equal(allowed(source,{host},lan),200);
  assert.equal(allowed(source,{host:"localhost:5474"},lan),403);
  assert.equal(allowed(source,{host:"oneearth.example:5474"},lan),403);
  assert.equal(allowed(source,{host,origin:"http://"+host+"/unexpected"},lan),403);
  assert.equal(allowed({localAddress,remoteAddress:"10.23.56.1"},{host,"x-forwarded-for":"10.23.49.5"},lan),403);
  assert.equal(allowed({localAddress,remoteAddress:"198.51.100.22"},{host},lan),403);
});
