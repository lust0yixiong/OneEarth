import {assetById,registerPapers} from "../src/domain/datasets";
import {catalogGroups,resources} from "../src/domain/catalog";
import {paperRecords,type PaperRecord} from "../src/domain/paper-record";

/** Hydrate only this turn's authorized exact records; never publish a catalogue. */
export function runtimeTurnPapers(){
  const records=new Map<string,PaperRecord>(),temporary=new Set<string>();
  return {
    get:(id:string)=>records.get(id),
    remember(batch:PaperRecord[]){
      for(const record of batch)if(!records.has(record.id)){
        if(!assetById.has(record.id))temporary.add(record.id);
        records.set(record.id,record);
      }
      registerPapers([...records.values()],false);
    },
    close(){
      for(const id of temporary){assetById.delete(id);paperRecords.delete(id);}
      for(let i=resources.length-1;i>=0;i--)if(temporary.has(resources[i].id))resources.splice(i,1);
      for(let i=catalogGroups.length-1;i>=0;i--)if(temporary.has(catalogGroups[i].id))catalogGroups.splice(i,1);
      records.clear();temporary.clear();
    },
  };
}
