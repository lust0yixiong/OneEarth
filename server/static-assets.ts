import express, { type RequestHandler } from "express";

/** Serve precompressed, content-hashed Vite assets without delaying API streams. */
export function staticAssets(directory: string): RequestHandler {
  const options = { maxAge: "1y", immutable: true, index: false as const, redirect: false };
  const variants = {
    br: express.static(directory, {...options, setHeaders(res, file) {
      res.setHeader("Content-Encoding", "br");
      res.setHeader("Content-Type", file.endsWith(".css.br") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
    }}),
    gzip: express.static(directory, {...options, setHeaders(res, file) {
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Type", file.endsWith(".css.gz") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
    }}),
  };
  const plain = express.static(directory, options);
  return (req, res, next) => {
    if (!/\.(js|css)$/.test(req.path) || !["GET", "HEAD"].includes(req.method)) {
      plain(req, res, next);
      return;
    }
    res.vary("Accept-Encoding");
    const encoding = req.acceptsEncodings("br", "gzip", "identity");
    if (encoding !== "br" && encoding !== "gzip") {
      plain(req, res, next);
      return;
    }
    const original = req.url;
    const query = original.indexOf("?");
    const suffix = encoding === "br" ? ".br" : ".gz";
    req.url = query < 0 ? original + suffix : original.slice(0, query) + suffix + original.slice(query);
    variants[encoding](req, res, error => {
      req.url = original;
      if (error) next(error);
      else plain(req, res, next);
    });
  };
}
