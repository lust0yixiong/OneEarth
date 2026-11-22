export type ObservationEvidence = {
  artifactId: string;
  version: string;
  sha256: string;
  variable: string;
  unit: string;
  count: number;
  first: string|null;
  last: string|null;
};
