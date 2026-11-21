import type { RequestHandler } from "express";

const localHosts = ["localhost", "127.0.0.1", "[::1]"];

/** Allow only explicitly named entry points, including SSH loopback tunnels. */
export function accessGuard(configuredHosts = ""): RequestHandler {
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
      approved = !!host && target.host.toLowerCase() === host.toLowerCase() && hosts.has(target.hostname.toLowerCase());
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
