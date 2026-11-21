import {rainColor,rainFactors,rainGrid,rainLevel,rainTileSize,rainTileXY,rainVisibleTiles} from "../domain/rainfall";
import type {XY} from "../domain/regional-cases";
import type {GeoProjection} from "d3-geo";
import type {RainTiles} from "./rain-tiles";

const vertexSource=`
attribute vec2 position;
void main(){gl_Position=vec4(position,0.0,1.0);}
`;
const fragmentSource=`
precision highp float;
uniform vec2 origin;
uniform vec2 center;
uniform float radius;
uniform float height;
uniform float pixelRatio;
uniform float level;
uniform sampler2D coarse;
uniform sampler2D middle;
uniform sampler2D nativeGrid;
uniform sampler2D coarseMask;
uniform sampler2D middleMask;
uniform sampler2D nativeMask;
uniform sampler2D ramp;
const float PI=3.141592653589793;
float decode(vec4 raw){return floor(raw.r*255.0+0.5)+floor(raw.a*255.0+0.5)*256.0;}
void main(){
  vec2 point=vec2(gl_FragCoord.x/pixelRatio,height-gl_FragCoord.y/pixelRatio);
  vec2 ray=(point-origin)/radius;
  float depth=1.0-dot(ray,ray);
  if(depth<=0.0)discard;
  float z=sqrt(depth);
  float b=-ray.y;
  float lat=asin(clamp(b*cos(center.y)+z*sin(center.y),-1.0,1.0));
  float lon=center.x+atan(ray.x,z*cos(center.y)-b*sin(center.y));
  vec2 uv=vec2(fract((lon+PI)/(2.0*PI)),clamp((PI*0.5-lat)/PI,0.0000001,0.9999999));
  float value=65535.0;
  if(level>1.5 && texture2D(nativeMask,uv).r>0.5)value=decode(texture2D(nativeGrid,uv));
  else if(level>0.5 && texture2D(middleMask,uv).r>0.5)value=decode(texture2D(middle,uv));
  else if(texture2D(coarseMask,uv).r>0.5)value=decode(texture2D(coarse,uv));
  if(value>65534.0){gl_FragColor=vec4(vec3(0.898),1.0);return;}
  vec3 colour=texture2D(ramp,vec2((min(value,1500.0)+0.5)/1501.0,0.5)).rgb;
  float shade=0.87+0.13*z-0.055*ray.x-0.05*ray.y;
  gl_FragColor=vec4(colour*shade,1.0);
}
`;

export function createRainPainter(onRestore:()=>void){
  const canvas=document.createElement("canvas");
  const gl=canvas.getContext("webgl",{alpha:true,antialias:false,premultipliedAlpha:false});
  if(!gl)throw Error("浏览器无法启用降水图层，请启用硬件加速后重试。");
  let program:WebGLProgram|null=null;
  let textures:WebGLTexture[]=[];
  let monthKey="",lost=false;
  let uploaded=rainFactors.map(()=>new Set<number>());
  let masks=rainFactors.map(f=>new Uint8Array(rainGrid.columns/f/rainTileSize*rainGrid.rows/f/rainTileSize));
  const uniforms=new Map<string,WebGLUniformLocation|null>();
  let buffer:WebGLBuffer|null=null;
  function compile(type:number,source:string){
    const shader=gl!.createShader(type)!;
    gl!.shaderSource(shader,source);gl!.compileShader(shader);
    if(!gl!.getShaderParameter(shader,gl!.COMPILE_STATUS))throw Error(gl!.getShaderInfoLog(shader)||"降水着色器加载失败");
    return shader;
  }
  function texture(unit:number,width:number,height:number,format:number,data:ArrayBufferView|null){
    gl!.activeTexture(gl!.TEXTURE0+unit);
    gl!.bindTexture(gl!.TEXTURE_2D,textures[unit]);
    gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_MIN_FILTER,gl!.NEAREST);
    gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_MAG_FILTER,gl!.NEAREST);
    gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_WRAP_S,gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D,gl!.TEXTURE_WRAP_T,gl!.CLAMP_TO_EDGE);
    gl!.texImage2D(gl!.TEXTURE_2D,0,format,width,height,0,format,gl!.UNSIGNED_BYTE,data);
  }
  function init(){
    const vertex=compile(gl!.VERTEX_SHADER,vertexSource),fragment=compile(gl!.FRAGMENT_SHADER,fragmentSource);
    program=gl!.createProgram()!;
    gl!.attachShader(program,vertex);gl!.attachShader(program,fragment);gl!.linkProgram(program);
    gl!.deleteShader(vertex);gl!.deleteShader(fragment);
    if(!gl!.getProgramParameter(program,gl!.LINK_STATUS))throw Error("降水着色器连接失败");
    gl!.useProgram(program);
    buffer=gl!.createBuffer();gl!.bindBuffer(gl!.ARRAY_BUFFER,buffer);
    gl!.bufferData(gl!.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl!.STATIC_DRAW);
    const position=gl!.getAttribLocation(program,"position");
    gl!.enableVertexAttribArray(position);gl!.vertexAttribPointer(position,2,gl!.FLOAT,false,0,0);
    for(const name of ["origin","center","radius","height","pixelRatio","level","coarse","middle","nativeGrid","coarseMask","middleMask","nativeMask","ramp"])
      uniforms.set(name,gl!.getUniformLocation(program,name));
    textures=Array.from({length:7},()=>gl!.createTexture()!);
    gl!.pixelStorei(gl!.UNPACK_ALIGNMENT,1);
    ["coarse","middle","nativeGrid","coarseMask","middleMask","nativeMask","ramp"].forEach((name,i)=>gl!.uniform1i(uniforms.get(name)!,i));
    const colours=document.createElement("canvas");colours.width=1501;colours.height=1;
    const context=colours.getContext("2d")!;
    for(let i=0;i<=1500;i++){context.fillStyle=rainColor(i/100);context.fillRect(i,0,1,1);}
    texture(6,1501,1,gl!.RGBA,context.getImageData(0,0,1501,1).data);
    monthKey="";
  }
  const contextLost=(event:Event)=>{event.preventDefault();lost=true;};
  const contextRestored=()=>{lost=false;init();onRestore();};
  canvas.addEventListener("webglcontextlost",contextLost);
  canvas.addEventListener("webglcontextrestored",contextRestored);
  init();
  return {
    draw(ctx:CanvasRenderingContext2D,p:GeoProjection,tiles:RainTiles,month:number,width:number,height:number,focusWidth:number,moving:boolean){
      const [cx,cy]=p.translate(),radius=p.scale();
      const rotation=p.rotate(),center:XY=[-rotation[0],-rotation[1]];
      const level=rainLevel(radius),ids=rainVisibleTiles(level,center,radius,cx,cy,focusWidth,height);
      if(!moving)tiles.setView(month,level,ids);
      if(lost)return level;
      const key=tiles.manifest.id+"/"+month;
      if(monthKey!==key){
        monthKey=key;
        uploaded=rainFactors.map(()=>new Set<number>());
        masks=rainFactors.map(f=>new Uint8Array(rainGrid.columns/f/rainTileSize*rainGrid.rows/f/rainTileSize));
        rainFactors.forEach((factor,i)=>{
          const columns=rainGrid.columns/factor,rows=rainGrid.rows/factor;
          texture(i,columns,rows,gl!.LUMINANCE_ALPHA,null);
          texture(i+3,columns/rainTileSize,rows/rainTileSize,gl!.LUMINANCE,masks[i]);
        });
      }
      // Upload only requested, already-decoded numeric tiles. Missing values retain their mask.
      rainFactors.forEach((factor,i)=>{
        const count=rainGrid.columns/factor/rainTileSize*rainGrid.rows/factor/rainTileSize;
        let changed=false;
        for(let id=0;id<count;id++){
          if(uploaded[i].has(id))continue;
          const data=tiles.get(month,i,id);if(!data)continue;
          const {x,y}=rainTileXY(i,id);
          gl!.activeTexture(gl!.TEXTURE0+i);gl!.bindTexture(gl!.TEXTURE_2D,textures[i]);
          gl!.texSubImage2D(gl!.TEXTURE_2D,0,x*rainTileSize,y*rainTileSize,rainTileSize,rainTileSize,
            gl!.LUMINANCE_ALPHA,gl!.UNSIGNED_BYTE,new Uint8Array(data.buffer,data.byteOffset,data.byteLength));
          uploaded[i].add(id);masks[i][id]=255;changed=true;
        }
        if(changed)texture(i+3,rainGrid.columns/factor/rainTileSize,rainGrid.rows/factor/rainTileSize,gl!.LUMINANCE,masks[i]);
      });
      const ratio=Math.min(devicePixelRatio,2);
      const w=Math.round(width*ratio),h=Math.round(height*ratio);
      if(canvas.width!==w || canvas.height!==h){canvas.width=w;canvas.height=h;}
      gl!.viewport(0,0,w,h);gl!.clearColor(0,0,0,0);gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.uniform2f(uniforms.get("origin")!,cx,cy);
      gl!.uniform2f(uniforms.get("center")!,center[0]*Math.PI/180,center[1]*Math.PI/180);
      gl!.uniform1f(uniforms.get("radius")!,radius);gl!.uniform1f(uniforms.get("height")!,height);
      gl!.uniform1f(uniforms.get("pixelRatio")!,ratio);gl!.uniform1f(uniforms.get("level")!,level);
      gl!.drawArrays(gl!.TRIANGLE_STRIP,0,4);
      ctx.drawImage(canvas,0,0,width,height);
      return level;
    },
    dispose(){
      canvas.removeEventListener("webglcontextlost",contextLost);
      canvas.removeEventListener("webglcontextrestored",contextRestored);
      textures.forEach(t=>gl!.deleteTexture(t));
      gl!.deleteBuffer(buffer);gl!.deleteProgram(program);
    }
  };
}
