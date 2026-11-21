// Screen-space marching squares over the same smoothed field as the heatmap.
export const contourLevels=[.12,.26,.4,.54,.68,.82,.96];
export function contourSegments(values:Float32Array,width:number,height:number,level:number) {
  const segments:number[]=[];
  for(let y=0;y<height-1;y++)for(let x=0;x<width-1;x++){
    const a=values[y*width+x],b=values[y*width+x+1],c=values[(y+1)*width+x+1],d=values[(y+1)*width+x];
    const code=Number(a>=level)+2*Number(b>=level)+4*Number(c>=level)+8*Number(d>=level);
    if(code===0 || code===15)continue;
    const high=[a>=level,b>=level,c>=level,d>=level];
    const points:([number,number]|undefined)[]=[
      high[0]!==high[1]?[x+(level-a)/(b-a),y]:undefined,
      high[1]!==high[2]?[x+1,y+(level-b)/(c-b)]:undefined,
      high[2]!==high[3]?[x+(level-d)/(c-d),y+1]:undefined,
      high[3]!==high[0]?[x,y+(level-a)/(d-a)]:undefined,
    ];
    const crossings=points.flatMap((point,i)=>point?[i]:[]);
    // The bilinear asymptotic decider preserves connectivity at saddle points;
    // the corner average can connect two peaks across a lower-valued gap.
    const determinant=(a-level)*(c-level)-(b-level)*(d-level);
    const pairs=crossings.length===2?[crossings]:
      determinant>=0?[[0,1],[2,3]]:[[0,3],[1,2]];
    for(const [from,to] of pairs){
      const p=points[from]!,q=points[to]!;
      if(p[0]!==q[0] || p[1]!==q[1])segments.push(...p,...q);
    }
  }
  return new Float32Array(segments);
}
