import { readFileSync } from "node:fs";

const title = JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
export const releaseVersion:string = title.version;
