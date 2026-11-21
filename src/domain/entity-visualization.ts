import type {Asset} from "./datasets";
import {observationById,observationURL} from "./push-observations";
import type {DataEntity} from "./types";
/** A format mention or DOI alone does not establish an available data entity. */
export function visualizationEntities(asset:Asset):DataEntity[] {
  const observation=observationById(asset.id);
  const found=new Map<string,DataEntity>();
  function add(url:string,label:string) {
    if(!/^https?:\/\//i.test(url) && !url.startsWith("/api/constellations/"))return;
    const extension=/\.(tiff?|shp)(?:[?#]|$)/i.exec(label) || /\.(tiff?|shp)(?:[?#]|$)/i.exec(url);
    if(!extension)return;
    found.set(url,{label,url,format:/^tif/i.test(extension[1])?"GeoTIFF":"Shapefile"});
  }
  for(const entity of asset.dataEntities || [])add(entity.url,entity.label);
  if(observation?.file)add(observationURL(observation.key)+"/file",observation.file.name);
  for(const url of [asset.url,...asset.tabs.map(t=>t.url)].filter((s):s is string=>!!s))add(url,url);
  for(const tab of asset.tabs)for(const row of tab.rows || [])for(const cell of row)
    if(typeof cell==="string")for(const url of cell.match(/https?:\/\/[^\s<>"'，。；）)]+/g)||[])add(url,url);
  return [...found.values()];
}
