import {useEffect,useRef,useState} from "react";
import {Layers,X} from "lucide-react";
import type {Asset} from "../domain/datasets";
import {visualizationEntities} from "../domain/entity-visualization";
import {regionalForDataset} from "../domain/regional-cases";
import {useWorkspace} from "../domain/store";

export function EntityVisualization({asset}:{asset:Asset}) {
  const {openVisualization}=useWorkspace();
  const layer=asset.datasetId?regionalForDataset(asset.datasetId):undefined;
  const entities=visualizationEntities(asset);
  const [open,setOpen]=useState(false),dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
  if(layer)return <button className="entity-visualization" onClick={()=>openVisualization(layer,null)}><Layers size={13}/>在球上可视化</button>;
  if(!entities.length)return null;
  return <><button className="entity-visualization" onClick={()=>setOpen(true)}><Layers size={13}/>在球上可视化 <small>待支持</small></button>
    {open && <dialog className="entity-visualization-dialog" ref={dialog} onClose={()=>setOpen(false)} aria-label="数据实体可视化">
      <button className="dialog-close" onClick={()=>dialog.current?.close()} aria-label="关闭数据实体可视化"><X size={16}/></button>
      <h3>在球上可视化</h3><p>{asset.title}</p>
      <p>已关联 {entities.length} 个数据实体。直接读取 TIFF、Shape 并叠加到球上的功能待支持；目前可以打开源文件，查看已接入的数据位置。</p>
      <ul>{entities.map(entity=><li key={entity.url}><span>{entity.format}</span><a href={entity.url} target="_blank" rel="noreferrer">{entity.label===entity.url?(entity.url.split("/").at(-1) || entity.format):entity.label}</a></li>)}</ul>
      <button onClick={()=>dialog.current?.close()}>知道了</button>
    </dialog>}
  </>;
}
