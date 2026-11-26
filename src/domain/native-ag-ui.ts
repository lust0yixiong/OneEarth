import {PROTOCOL_VERSION} from "@ag-ui/core";
import {validClarificationPrompt,type ClarificationAnswer,type ClarificationPrompt} from "./clarification";
import type {DiscoveryResponse,QuestionCheck} from "./types";

export const nativeAgUiPath = "/api/ag-ui";
export const nativeAgUiProtocolVersion = PROTOCOL_VERSION;
export const oneEarthAgUiVersion = 1;

type JsonRecord = Record<string, unknown>;

export type OneEarthAgUiForwardedProps<T extends object = JsonRecord> = {
  oneearth: {
    version: typeof oneEarthAgUiVersion;
    submission: T;
  };
};

export type OneEarthAgUiResult = {
  oneearth: {
    version: typeof oneEarthAgUiVersion;
    messageId: string;
    response: DiscoveryResponse;
  };
};

export type OneEarthAgUiResumePayload = Pick<ClarificationAnswer,"optionId"|"text">;
export type OneEarthQuestionCheckResumePayload =
  | {choice:"original"|"proposed";dataQuestion?:never}
  | {choice:"edited";dataQuestion:string};

type InterruptIdentity = {
  id: string;
  status: "pending" | "resolved" | "cancelled" | "unavailable";
  resumedBy?: string;
};
export type OneEarthAgUiInterruptRecord = InterruptIdentity & (
  | {kind?:"clarification";prompt:ClarificationPrompt}
  | {kind:"question-check";questionCheck:QuestionCheck}
);

const nativeId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readOneEarthEnvelope(value: unknown): JsonRecord | undefined {
  if (!isRecord(value) || !isRecord(value.oneearth)) return;
  return value.oneearth.version === oneEarthAgUiVersion ? value.oneearth : undefined;
}

export function readOneEarthAgUiSubmission(forwardedProps: unknown): JsonRecord | undefined {
  const submission = readOneEarthEnvelope(forwardedProps)?.submission;
  return isRecord(submission) ? submission : undefined;
}

export function readOneEarthAgUiResult(result: unknown, messageId: string): DiscoveryResponse | undefined {
  const envelope = readOneEarthEnvelope(result);
  if (envelope?.messageId !== messageId || !isRecord(envelope.response) || typeof envelope.response.message !== "string") return;
  return envelope.response as unknown as DiscoveryResponse;
}

export function readOneEarthAgUiInterruptRecord(value: unknown, runId: string): OneEarthAgUiInterruptRecord | undefined {
  if (!isRecord(value) || !nativeId.test(runId) || value.id !== runId) return;
  const {status,resumedBy} = value;
  if (status !== "pending" && status !== "resolved" && status !== "cancelled" && status !== "unavailable") return;
  if (resumedBy !== undefined && (typeof resumedBy !== "string" || resumedBy === runId || !nativeId.test(resumedBy))) return;
  if ((status === "pending" || status === "unavailable") && resumedBy !== undefined) return;
  if (status === "resolved" && resumedBy === undefined) return;
  const identity:InterruptIdentity={id:runId,status,...(resumedBy ? {resumedBy} : {})};
  if (value.kind==="question-check") {
    const check=value.questionCheck;
    if (!isRecord(check) || !isQuestion(check.originalQuestion) || !isQuestion(check.proposedQuestion)) return;
    return {...identity,kind:"question-check",questionCheck:{originalQuestion:check.originalQuestion,proposedQuestion:check.proposedQuestion}};
  }
  if ((value.kind===undefined || value.kind==="clarification") && validClarificationPrompt(value.prompt)) {
    return {...identity,...(value.kind ? {kind:value.kind} : {}),prompt:value.prompt};
  }
}

function isQuestion(value:unknown):value is string {
  return typeof value==="string" && !!value.trim() && value.length<=4000 && !value.includes("\0");
}
