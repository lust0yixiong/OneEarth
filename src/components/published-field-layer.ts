import {c40CityFlight,type FieldLayerSelection} from "../domain/globe-dataset-layers";
import {publishedWorkspaceLayerRecipes,type WorkspacePublishedLayerAction} from "../domain/workspace-published-layer";
import {readC40Catalogue,type PublishedCities} from "./use-c40-layer";
import {readForestPublication,type ForestPublication} from "./use-forest-layer";

export type PublishedFieldCatalogues={c40?:PublishedCities;forest?:ForestPublication};

export async function resolvePublishedFieldLayer(action:WorkspacePublishedLayerAction,signal:AbortSignal) {
  const recipe=publishedWorkspaceLayerRecipes[action.datasetId];
  if(recipe.layerId==="c40"){
    const catalogue=await readC40Catalogue(signal);
    if(catalogue.revision!==action.publicationRevision)return;
    const city=catalogue.manifest.cities.find(city=>city.id===action.valueId);
    if(!city)return;
    const field:FieldLayerSelection={id:recipe.layerId,frame:0,city:city.id};
    return {field,label:city.name,catalogues:{c40:catalogue},flight:c40CityFlight(city)};
  }
  const catalogue=await readForestPublication(signal);
  if(catalogue.revision!==action.publicationRevision)return;
  const frame=catalogue.manifest.frames.findIndex(frame=>frame.date===action.valueId);
  if(frame<0)return;
  const field:FieldLayerSelection={id:recipe.layerId,frame,date:action.valueId};
  return {field,label:action.valueId,catalogues:{forest:catalogue}};
}
