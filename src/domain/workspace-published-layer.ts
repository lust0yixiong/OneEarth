import {datasetLayers, globeCases, isForestDate} from "./regional-cases";

/** Capabilities provided by the existing published-layer viewers. */
export const publishedWorkspaceLayerRecipes = {
  [datasetLayers.c40]: {layerId:"c40", controlId:"city", title:globeCases.c40.title},
  [datasetLayers.forest]: {layerId:"forest", controlId:"time", title:globeCases.forest.title},
} as const;

export type PublishedWorkspaceLayerId = keyof typeof publishedWorkspaceLayerRecipes;

export type WorkspacePublishedLayerAction = {
  kind: "open-published-layer";
  datasetId: PublishedWorkspaceLayerId;
  valueId: string;
  publicationRevision: string;
};

export function isPublishedWorkspaceLayerId(value: unknown): value is PublishedWorkspaceLayerId {
  return typeof value==="string" && Object.hasOwn(publishedWorkspaceLayerRecipes,value);
}

/** This validates the receipt shape. The current publication must verify its value before use. */
export function validWorkspacePublishedLayerAction(value: unknown): value is WorkspacePublishedLayerAction {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const action=value as Partial<WorkspacePublishedLayerAction>;
  if(Object.keys(action).length!==4||action.kind!=="open-published-layer"||
      !isPublishedWorkspaceLayerId(action.datasetId)||typeof action.valueId!=="string"||
      typeof action.publicationRevision!=="string"||!/^[a-f0-9]{64}$/.test(action.publicationRevision))return false;
  return publishedWorkspaceLayerRecipes[action.datasetId].controlId==="city"
    ? /^[a-z0-9][a-z0-9-]{0,79}$/.test(action.valueId)
    : isForestDate(action.valueId);
}
