export type AdminArea={level:number;name:string;id:string;year:string;kind:string;source:string;url:string;license:string};
export type AdminLocation={country:string;point:[number,number];requestedLevel:number;availableLevels:number[];areas:AdminArea[];partial:boolean};

/** View zoom is an orthographic scale multiplier, not an XYZ tile zoom. */
export function administrativeLevel(scale:number) {
  if(scale<8)return 0;
  if(scale<32)return 1;
  if(scale<120)return 2;
  if(scale<400)return 3;
  if(scale<1200)return 4;
  return 5;
}
export function administrativeLabel(country:string,areas:AdminArea[],level:number) {
  return [...new Set([country,...areas.filter(a=>a.level<=level).sort((a,b)=>a.level-b.level).map(a=>a.name)])].join(" · ");
}
