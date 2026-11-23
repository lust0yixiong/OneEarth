import type { RequestHandler } from "express";
import {BlockList, isIPv4} from "node:net";
import {networkInterfaces} from "node:os";

const localHosts = ["localhost", "127.0.0.1", "[::1]"];
const privateNetworks = new BlockList();
privateNetworks.addSubnet("10.0.0.0",8);
privateNetworks.addSubnet("172.16.0.0",12);
privateNetworks.addSubnet("192.168.0.0",16);

export interface WorkbenchLan {
  address:string;
  peers:BlockList;
}

/** Resolve only the explicitly selected interface, with one private IPv4 address. */
export function workbenchLan(name:string|undefined, interfaces=networkInterfaces()):WorkbenchLan|undefined {
  if(!name)return;
  const entries=(interfaces[name]||[]).filter(info=>info.family==="IPv4"&&!info.internal&&privateNetworks.check(info.address));
  if(entries.length!==1)return;
  const {address,cidr}=entries[0];
  const prefix=Number(cidr?.split("/")[1]);
  if(!Number.isInteger(prefix)||prefix<8||prefix>30)return;
  const peers=new BlockList();
  peers.addSubnet(address,prefix);
  return {address,peers};
}

/** Preserve named Host and Origin checks, with a direct subnet check on the LAN socket. */
export function accessGuard(configuredHosts = "",lan?:WorkbenchLan): RequestHandler {
  const hosts = new Set(localHosts);
  for (const entry of configuredHosts.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (!/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])$/.test(entry)) {
      throw Error("ONEEARTH_ALLOWED_HOSTS 仅接受逗号分隔的主机名或 IP，不包含协议、端口或通配符。");
    }
    hosts.add(entry);
  }
  return (req, res, next) => {
    const host = req.get("host") || "";
    let approved = false;
    try {
      const target = new URL(`${req.protocol}://${host}`);
      let allowedHost=hosts.has(target.hostname.toLowerCase());
      if(lan&&req.socket.localAddress===lan.address){
        const source=req.socket.remoteAddress?.replace(/^::ffff:/i,"")||"";
        allowedHost=target.hostname===lan.address&&isIPv4(source)&&privateNetworks.check(source)&&lan.peers.check(source);
      }
      approved = !!host && target.host.toLowerCase() === host.toLowerCase() && allowedHost;
      const origin = req.get("origin");
      if (origin && origin.toLowerCase() !== `${req.protocol}://${host}`.toLowerCase()) approved = false;
    } catch { /* Reject malformed or missing Host headers. */ }
    if (!approved) {
      res.status(403).json({ error: "请通过已配置的 OneEarth 地址访问。" });
      return;
    }
    next();
  };
}
