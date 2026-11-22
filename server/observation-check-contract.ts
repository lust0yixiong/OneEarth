import {timingSafeEqual} from "node:crypto";
import {observationMaterialId} from "../src/domain/observation-material";
import type {ObservationEvidence} from "../src/domain/observation-evidence";
export type {ObservationEvidence} from "../src/domain/observation-evidence";

export const observationCheckSkill = "oneearth.observation-check@1";
export const skillRequestKind = "oneearth.skill.observation-check.request.v1";
export const skillResultKind = "oneearth.skill.observation-check.result.v1";

export type ObservationCheck = {
  skill: typeof observationCheckSkill;
  artifactId: string;
  version: string;
  variable: string;
  unit: string;
  start: string;
  end: string;
};

export type ObservationDescription = Pick<ObservationCheck,"skill"|"artifactId"|"version"|"variable"> & {purpose:"describe"};
export type ObservationRequest = ObservationCheck|ObservationDescription;

export type ObservationCheckResult =
  | {status: "verified"; matches?: boolean; evidence: ObservationEvidence}
  | {status: "not_started"|"failed"|"cancelled"|"unknown"; reason: string};

export type SkillDemand = {requestId: string; researchTaskId: string; check: ObservationRequest};
export type SkillExecutionRequest = SkillDemand & {discoveryTaskId: string; expectedSha256: string; modelAuthorized?:true};
export type SkillResultSubmission = {requestId: string; afterSeq: number; result: ObservationCheckResult};

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export const observationId = observationMaterialId;

export function observationDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}

export function observationUnit(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 40
    && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
}

export function parseObservationCheck(value: unknown): ObservationCheck|undefined {
  if (!object(value) || !hasKeys(value, ["skill","artifactId","version","variable","unit","start","end"])) return;
  const {skill,artifactId,version,variable,unit,start,end} = value;
  if (skill !== observationCheckSkill || !observationId(artifactId) || !observationId(version) ||
      !observationId(variable) || !observationUnit(unit) || !observationDate(start) || !observationDate(end) || start>end) return;
  return {skill,artifactId,version,variable,unit,start,end};
}

export function parseObservationRequest(value: unknown): ObservationRequest|undefined {
  if(!object(value)||value.purpose!=="describe")return parseObservationCheck(value);
  if(!hasKeys(value,["skill","artifactId","version","variable","purpose"])||value.skill!==observationCheckSkill)return;
  const target=parseObservationReadTarget({artifactId:value.artifactId,version:value.version,variable:value.variable});
  if(target)return {skill:observationCheckSkill,purpose:"describe",...target};
}

export type ObservationReadTarget = Pick<ObservationCheck, "artifactId"|"version"|"variable">;
export type ObservationFailure = Exclude<ObservationCheckResult,{status:"verified"}>;

export function parseObservationReadTarget(value: unknown): ObservationReadTarget|undefined {
  if (!object(value) || !hasKeys(value, ["artifactId","version","variable"])) return;
  const {artifactId,version,variable} = value;
  if (observationId(artifactId) && observationId(version) && observationId(variable))
    return {artifactId,version,variable};
}

export function observationSha256(value: unknown): value is string {
  return typeof value==="string" && /^[0-9a-f]{64}$/.test(value);
}

export function validObservationEvidence(value: unknown): value is ObservationEvidence {
  if (!object(value) || !hasKeys(value, ["artifactId","version","sha256","variable","unit","count","first","last"]))
    return false;
  const {artifactId,version,sha256,variable,unit,count,first,last} = value;
  if (!observationId(artifactId) || !observationId(version) || !observationId(variable) || !observationUnit(unit) ||
      !observationSha256(sha256) || typeof count !== "number" ||
      !Number.isSafeInteger(count) || count < 0) return false;
  return count === 0 ? first === null && last === null
    : observationDate(first) && observationDate(last) && first <= last;
}

export function validObservationResult(value: unknown): value is ObservationCheckResult {
  if (!object(value)) return false;
  if (value.status !== "verified") {
    return hasKeys(value, ["status","reason"]) && typeof value.status === "string" &&
      ["not_started","failed","cancelled","unknown"].includes(value.status) && observationId(value.reason);
  }
  if(!validObservationEvidence(value.evidence))return false;
  if(hasKeys(value,["status","evidence"]))return true;
  return hasKeys(value,["status","matches","evidence"]) && typeof value.matches==="boolean" &&
    (value.evidence.count>0 || !value.matches);
}

export function observationResultMatchesRequest(result: ObservationCheckResult, check: ObservationRequest): boolean {
  if (result.status !== "verified") return true;
  const e = result.evidence;
  if(e.artifactId!==check.artifactId||e.version!==check.version||e.variable!==check.variable)return false;
  if("purpose" in check)return !Object.hasOwn(result,"matches");
  return result.matches===(e.unit===check.unit&&!!e.first&&!!e.last&&e.first<=check.start&&e.last>=check.end);
}

export function skillServiceAuthorized(authorization: string|undefined, token = process.env.ONEEARTH_SKILL_SERVICE_TOKEN): boolean {
  if (!token || token.length<32 || !authorization?.startsWith("Bearer ")) return false;
  const credential = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(token);
  return credential.length === expected.length && timingSafeEqual(credential, expected);
}
