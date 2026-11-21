import {geoPath} from "d3-geo";
import {catalogCellColor} from "../domain/results";
import {cellShape} from "../domain/spatial";
import type {DistributionMode} from "../domain/distribution-modes";
import {createDistributionField,createDistributionRaster,type DistributionPaintRequest} from "./distribution-field";
import {createDistributionHeatPainter} from "./distribution-heat";
import {createDistributionContourPainter} from "./distribution-contours";
export function createDistributionPainters():Record<DistributionMode,(request:DistributionPaintRequest)=>void>&{dispose:()=>void} {
  const raster=createDistributionRaster(),field=createDistributionField(raster),heat=createDistributionHeatPainter(field,raster);
  return {
    dispose:()=>heat.dispose(),
    grid:({ctx,projection,grid,counts,scenes,mesh})=>{
      const path=geoPath(projection,ctx);
      for(const [id,count] of counts){
        const color=catalogCellColor(count,scenes);if(!color)continue;
        ctx.beginPath();path(cellShape(id,grid).geometry);ctx.fillStyle=color;ctx.fill();
        ctx.strokeStyle=scenes&&mesh?"#256781":color;ctx.lineWidth=.65;ctx.stroke();
      }
    },
    heatmap:heat,
    contours:createDistributionContourPainter(field),
  };
}
