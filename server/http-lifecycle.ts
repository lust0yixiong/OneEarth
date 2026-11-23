import { createServer, type RequestListener, type Server } from "node:http";
import { once } from "node:events";

interface Listener {
  app: RequestListener;
  host: string;
  port: number;
  label: string;
  optional?: boolean;
}

/** Stop taking connections before ending streams or disposing their stores. */
export async function serveHttp(listeners: Listener[], resources?: {
  stopAccepting: () => Promise<unknown>;
  close: () => Promise<unknown>;
}) {
  const servers = new Set<Server>();
  let shutdown: Promise<void> | undefined;
  const stop = () => shutdown ??= finish();
  async function finish() {
    const drains = Promise.all([...servers].map(server =>
      new Promise<void>(resolve => server.close(() => resolve()))));
    const deadline = setTimeout(() => {
      for (const server of servers) server.closeAllConnections();
    }, 3_000).unref();
    try {
      await Promise.allSettled([drains, resources?.stopAccepting()]).then(results => {
        const failed = results.find(result => result.status === "rejected");
        if (failed) throw failed.reason;
      });
    } finally {
      clearTimeout(deadline);
      await resources?.close();
    }
  }
  const fail = (error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
    void stop().catch(e => console.error(e.message));
  };
  const terminate = () => { void stop().catch(fail); };
  process.once("SIGTERM", terminate);
  process.once("SIGINT", terminate);
  try {
    for (const {app,host,port,label,optional} of listeners) {
      if (shutdown) return;
      const server = createServer(app);
      servers.add(server);
      try {
        server.listen(port,host);
        await once(server,"listening");
      } catch (error) {
        servers.delete(server);
        if (!optional) throw error;
        console.error(label+": "+(error instanceof Error ? error.message : String(error)));
        continue;
      }
      server.on("error",fail);
      console.log(label+" on "+host+":"+port);
    }
  } catch (error) {
    await stop().catch(() => console.error("OneEarth could not release HTTP resources"));
    throw error;
  }
}
