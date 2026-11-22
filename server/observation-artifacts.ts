import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {open,realpath} from "node:fs/promises";
import path from "node:path";
import {validObservationMaterial,type ObservationMaterial} from "../src/domain/observation-material";
import {provenanceForBinding,validObservationSourceBinding,type ObservationSourceBinding} from "../src/domain/observation-source";
import {observationDate,observationId,observationUnit,type ObservationCheck,type ObservationReadTarget,type ObservationEvidence} from "./observation-check-contract";
import {readNetcdfObservation,ObservationNetcdfError,observationNetcdfMaxBytes} from "./observation-netcdf";

const maxBytes=1024*1024;

export class ObservationArtifactError extends Error {
  constructor(readonly reason: string) {super(reason);}
}

function object(value: unknown): value is Record<string,unknown> {
  return !!value&&typeof value==="object"&&!Array.isArray(value);
}

async function boundedFile(file: string,limit=maxBytes) {
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size>limit)throw new ObservationArtifactError("artifact_size");
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

export type ObservationArtifact = {file:string;sha256:string;variables:string[];sourceBinding?:ObservationSourceBinding};
export type PinnedObservationMaterial = ObservationMaterial & {sha256:string;sourceBinding?:ObservationSourceBinding};

async function loadRegistry(registry:string|undefined){
  if(!registry||!path.isAbsolute(registry))return;
  const file=await realpath(registry);
  const entries:unknown=JSON.parse((await boundedFile(file)).toString("utf8"));
  if(!object(entries)||!Array.isArray(entries.artifacts))throw new ObservationArtifactError("registry_invalid");
  return {file,entries:entries.artifacts.filter(object)};
}

function registryGrant(match:Record<string,unknown>,registeredFile:string):ObservationArtifact|undefined{
  const base=path.dirname(registeredFile);
  if(!Array.isArray(match.variables)||!match.variables.every(observationId)||
     typeof match.path!=="string"||path.isAbsolute(match.path)||match.path.includes("\0")||
     typeof match.sha256!=="string"||!/^[0-9a-f]{64}$/.test(match.sha256))return;
  const file=path.resolve(base,match.path);
  if(!file.startsWith(base+path.sep)||file===registeredFile)return;
  const grant={file,sha256:match.sha256,variables:[...match.variables] as string[]};
  if(match.source===undefined)return grant;
  const sourceBinding=object(match.source)&&{...match.source,artifactId:match.id,version:match.version};
  if(validObservationSourceBinding(sourceBinding))return {...grant,sourceBinding};
}

/** The permission lookup opens the operator's registry. Only the reader opens the observation file. */
export async function observationArtifact(
  check: ObservationReadTarget, registry=process.env.ONEEARTH_SKILL_REGISTRY, requireModelGrant=false,
): Promise<ObservationArtifact|undefined> {
  const current=await loadRegistry(registry);
  if(!current)return;
  const matches=current.entries.filter(e=>e.id===check.artifactId&&e.version===check.version);
  if(matches.length!==1)return;
  const entry=matches[0];
  if((requireModelGrant&&entry.modelVisible!==true)||!Array.isArray(entry.variables)||!entry.variables.includes(check.variable))return;
  return registryGrant(entry,current.file);
}

/** Title and variable names are operator-approved metadata; raw values are never opened here. */
export async function observationModelMaterials():Promise<PinnedObservationMaterial[]>{
  if((process.env.ONEEARTH_SKILL_SERVICE_TOKEN?.length??0)<32)return [];
  const registry=await loadRegistry(process.env.ONEEARTH_SKILL_REGISTRY);
  if(!registry)return [];
  const counts=new Map<string,number>();
  for(const e of registry.entries){
    if(!observationId(e.id)||!observationId(e.version))continue;
    const key=JSON.stringify([e.id,e.version]);
    counts.set(key,(counts.get(key)??0)+1);
  }
  const materials:PinnedObservationMaterial[]=[];
  for(const e of registry.entries){
    if(e.modelVisible!==true||!observationId(e.id)||!observationId(e.version)||
       counts.get(JSON.stringify([e.id,e.version]))!==1)continue;
    const grant=registryGrant(e,registry.file);
    const material={artifactId:e.id,version:e.version,title:e.title??e.id,variables:e.variables};
    if(grant&&validObservationMaterial(material))materials.push({...material,sha256:grant.sha256,
      ...(grant.sourceBinding?{sourceBinding:grant.sourceBinding}:{})});
  }
  return materials;
}

export async function authorizeObservationDigest(check: ObservationCheck): Promise<string|undefined> {
  if(!process.env.ONEEARTH_SKILL_SERVICE_TOKEN||process.env.ONEEARTH_SKILL_SERVICE_TOKEN.length<32)return;
  try {return (await observationArtifact(check))?.sha256;}
  catch {return undefined;}
}

export async function readObservationArtifact(
  check: ObservationReadTarget, registry: string, expectedSha256: string, requireModelGrant=false,
): Promise<ObservationEvidence> {
  const grant=await observationArtifact(check,registry,requireModelGrant);
  if(!grant||grant.sha256!==expectedSha256)throw new ObservationArtifactError("authorization_changed");
  const actual=await realpath(grant.file);
  const base=path.dirname(await realpath(registry));
  if(!actual.startsWith(base+path.sep)||actual===await realpath(registry))throw new ObservationArtifactError("artifact_path");
  const bytes=await boundedFile(actual,observationNetcdfMaxBytes);
  const sha256=createHash("sha256").update(bytes).digest("hex");
  if(sha256!==grant.sha256)throw new ObservationArtifactError("artifact_changed");
  const artifactSource=provenanceForBinding(grant.sourceBinding);
  const provenance=artifactSource?{artifactSource}:{};
  if(bytes.toString("ascii",0,3)==="CDF"){
    try{return {...readNetcdfObservation(bytes,check,sha256,grant.variables),...provenance};}
    catch(error){if(error instanceof ObservationNetcdfError)throw new ObservationArtifactError(error.reason);throw error;}
  }
  if(bytes.length>maxBytes)throw new ObservationArtifactError("artifact_size");
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
  return {artifactId:check.artifactId,version:check.version,sha256,variable:check.variable,unit:source.unit,count,first,last,...provenance};
}
