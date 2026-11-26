import {PROTOCOL_VERSION} from "@ag-ui/core";
import type {DiscoveryResponse} from "./types";

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
