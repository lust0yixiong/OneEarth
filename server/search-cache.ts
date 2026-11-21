/** Successful public source snapshots only. Failures are always retried.
 * Cache ownership is local to this service; cancellation never poisons a key. */
export function sourceSnapshotCache(maxEntries=128,maxBytes=16*1024*1024,now=Date.now) {
  const rows=new Map<string,{at:number;json:string;bytes:number}>();let bytes=0;
  return {
    get(key:string,ttl:number):{data:any;cacheStoredAt:string}|undefined {
      const row=rows.get(key);if(!row)return;
      if(now()-row.at>=ttl){rows.delete(key);bytes-=row.bytes;return;}
      rows.delete(key);rows.set(key,row);
      return {data:JSON.parse(row.json),cacheStoredAt:new Date(row.at).toISOString()};
    },
    put(key:string,data:unknown){
      const json=JSON.stringify(data),size=Buffer.byteLength(json);if(size>256*1024)return;
      const old=rows.get(key);if(old){rows.delete(key);bytes-=old.bytes;}
      rows.set(key,{at:now(),json,bytes:size});bytes+=size;
      while(rows.size>maxEntries||bytes>maxBytes){const key=rows.keys().next().value!;bytes-=rows.get(key)!.bytes;rows.delete(key);}
    },
  };
}
