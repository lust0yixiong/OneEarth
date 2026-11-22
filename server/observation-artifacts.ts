import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {open,realpath} from "node:fs/promises";
import path from "node:path";
import {observationDate,observationId,observationUnit,type ObservationCheck,type ObservationReadTarget,type ObservationEvidence} from "./observation-check-contract";

const maxBytes=1024*1024;

export class ObservationArtifactError extends Error {
  constructor(readonly reason: string) {super(reason);}
}

function object(value: unknown): value is Record<string,unknown> {
  return !!value&&typeof value==="object"&&!Array.isArray(value);
}

async function boundedFile(file: string) {
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size>maxBytes)throw new ObservationArtifactError("artifact_size");
    const bytes=Buffer.alloc(stat.size+1);
    let offset=0;
    while(offset<bytes.length){
      const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);
      if(!bytesRead)break;
      offset+=bytesRead;
    }
    if(offset!==stat.size)throw new ObservationArtifactError("artifact_changed");
    return bytes.subarray(0,offset);
  } finally {await handle.close();}
}

export type ObservationArtifact = {file:string;sha256:string};

/** The permission lookup opens the operator's registry. Only the reader opens the observation file. */
export async function observationArtifact(
  check: ObservationReadTarget, registry=process.env.ONEEARTH_SKILL_REGISTRY,
): Promise<ObservationArtifact|undefined> {
  if(!registry||!path.isAbsolute(registry))return;
  const registeredFile=await realpath(registry);
  const base=path.dirname(registeredFile);
  const entries:unknown=JSON.parse((await boundedFile(registeredFile)).toString("utf8"));
  if(!object(entries)||!Array.isArray(entries.artifacts))throw new ObservationArtifactError("registry_invalid");
  const matches=entries.artifacts.filter(e=>object(e)&&e.id===check.artifactId&&e.version===check.version);
  if(matches.length!==1)return;
  const match=matches[0] as Record<string,unknown>;
  if(!Array.isArray(match.variables)||!match.variables.every(observationId)||!match.variables.includes(check.variable))return;
  if(typeof match.path!=="string"||path.isAbsolute(match.path)||match.path.includes("\0")||
     typeof match.sha256!=="string"||!/^[0-9a-f]{64}$/.test(match.sha256))return;
  const file=path.resolve(base,match.path);
  if(!file.startsWith(base+path.sep)||file===registeredFile)return;
  return {file,sha256:match.sha256};
}

export async function authorizeObservationCheck(check: ObservationCheck): Promise<boolean> {
  if(!process.env.ONEEARTH_SKILL_SERVICE_TOKEN||process.env.ONEEARTH_SKILL_SERVICE_TOKEN.length<32)return false;
  try {return !!await observationArtifact(check);}
  catch {return false;}
}

export async function readObservationArtifact(
  check: ObservationReadTarget, registry: string, expectedSha256: string,
): Promise<ObservationEvidence> {
  const grant=await observationArtifact(check,registry);
  if(!grant||grant.sha256!==expectedSha256)throw new ObservationArtifactError("authorization_changed");
  const actual=await realpath(grant.file);
  const base=path.dirname(await realpath(registry));
  if(!actual.startsWith(base+path.sep)||actual===await realpath(registry))throw new ObservationArtifactError("artifact_path");
  const bytes=await boundedFile(actual);
  const sha256=createHash("sha256").update(bytes).digest("hex");
  if(sha256!==grant.sha256)throw new ObservationArtifactError("artifact_changed");
  const raw:unknown=JSON.parse(bytes.toString("utf8"));
  if(!object(raw)||raw.schema!=="oneearth.observations.v1"||!object(raw.variables)||!Object.hasOwn(raw.variables,check.variable))
    throw new ObservationArtifactError("variable_unavailable");
  const source=raw.variables[check.variable];
  if(!object(source)||!observationUnit(source.unit)||!Array.isArray(source.records))
    throw new ObservationArtifactError("artifact_invalid");
  let first:string|null=null,last:string|null=null,count=0;
  for(const record of source.records){
    if(!object(record)||!observationDate(record.at)||
      (record.value!==null&&(typeof record.value!=="number"||!Number.isFinite(record.value))))
      throw new ObservationArtifactError("record_invalid");
    if(record.value===null)continue;
    if(first===null||record.at<first)first=record.at;
    if(last===null||record.at>last)last=record.at;
    count++;
  }
  return {artifactId:check.artifactId,version:check.version,sha256,variable:check.variable,unit:source.unit,count,first,last};
}
