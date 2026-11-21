// One fixed mapping across sources and camera positions. Heat is a smoothed
// display of counts; it never participates in membership, picking or exports.
const palette = [[255,255,178],[254,217,118],[254,178,76],[253,141,60],[240,59,32],[189,0,38]];
export const heatGradient = `linear-gradient(to right, ${palette.map(rgb=>`rgb(${rgb.join(",")})`).join(",")})`;
export function heatIntensity(count:number) {
  return Number.isFinite(count) && count>0 ? Math.min(1,Math.log1p(count)/Math.log1p(50)) : 0;
}
export function heatColor(strength:number) {
  const position=Math.max(0,Math.min(1,strength))*(palette.length-1),low=Math.floor(position);
  const a=palette[low],b=palette[Math.min(low+1,palette.length-1)];
  return a.map((v,i)=>Math.round(v+(b[i]-v)*(position-low)));
}
const gridColors=["#cfe6d8","#a8cfb7","#7fb696","#529875","#2b7656","#145137"];
export const countBands = [
  {min:1,label:"1"},{min:2,label:"2–4"},{min:5,label:"5–9"},
  {min:10,label:"10–19"},{min:20,label:"20–49"},{min:50,label:"50+"},
].map((band,i)=>({...band,color:gridColors[i]}));
export function countBand(count:number) {
  return Number.isFinite(count) && count>0 ? countBands.filter(band=>count>=band.min).at(-1) : undefined;
}

/** Finite Gaussian smoothing in screen space. Averages (rather than adds)
 * neighbouring counts, so a uniform area does not become hotter on overlap. */
export function smoothHeatField(input:Float32Array,width:number,height:number,sigma:number,scratch?:{middle:Float32Array;output:Float32Array}) {
  if(sigma<=0)return input.slice();
  const radius=Math.ceil(3*sigma),kernel=Array.from({length:2*radius+1},(_,i)=>Math.exp(-.5*((i-radius)/sigma)**2));
  const total=kernel.reduce((a,b)=>a+b,0);kernel.forEach((v,i)=>kernel[i]=v/total);
  const reusable=scratch && scratch.middle.length===input.length && scratch.output.length===input.length && scratch.middle!==input && scratch.output!==input && scratch.middle!==scratch.output;
  const middle=reusable?scratch.middle:new Float32Array(input.length),output=reusable?scratch.output:new Float32Array(input.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const first=Math.max(0,radius-x),last=Math.min(2*radius,radius+width-1-x);
    let value=0,index=y*width+x-radius+first;
    for(let k=first;k<=last;k++)value+=input[index++]*kernel[k];
    middle[y*width+x]=value;
  }
  for(let y=0;y<height;y++){
    const first=Math.max(0,radius-y),last=Math.min(2*radius,radius+height-1-y),row=(y-radius+first)*width;
    for(let x=0;x<width;x++){
      let value=0,index=row+x;
      for(let k=first;k<=last;k++){value+=middle[index]*kernel[k];index+=width;}
      output[y*width+x]=value;
    }
  }
  return output;
}
