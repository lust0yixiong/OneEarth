import {heatColor} from "../domain/distribution-heat";
import type {DistributionRaster} from "./distribution-field";

// The same finite, zero-padded Gaussian and fixed palette as the CPU path.
// This changes display computation only; picking and counts use the source index.
const vertex=`#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`;
const header=`#version 300 es
precision highp float;
uniform sampler2D image;
uniform float weights[19];
uniform int radius;
uniform ivec2 size;
out vec4 color;
`;
const horizontal=header+`void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);float v=0.;
  for(int i=-9;i<=9;i++){int x=p.x+i;if(abs(i)<=radius&&x>=0&&x<size.x)v+=texelFetch(image,ivec2(x,p.y),0).r*weights[i+9];}
  color=vec4(v,0.,0.,1.);
}`;
const vertical=header+`uniform sampler2D palette;
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);float v=0.;
  for(int i=-9;i<=9;i++){int y=p.y+i;if(abs(i)<=radius&&y>=0&&y<size.y)v+=texelFetch(image,ivec2(p.x,y),0).r*weights[i+9];}
  if(v<.025){color=vec4(0.);return;}
  float a=floor(235.*min(1.,v/.2)+.5)/255.;
  vec3 rgb=texelFetch(palette,ivec2(int(clamp(floor(v*255.+.5),0.,255.)),0),0).rgb;
  color=vec4(rgb*a,a);
}`;

export function createGpuHeatPainter() {
  const canvas=document.createElement("canvas");
  let failed=false,key="",width=0,height=0;
  let gl:WebGL2RenderingContext|null=null,programs:WebGLProgram[]=[],textures:WebGLTexture[]=[],frame:WebGLFramebuffer|null=null;
  function dispose(){
    failed=true;
    if(gl){for(const p of programs)gl.deleteProgram(p);for(const t of textures)gl.deleteTexture(t);if(frame)gl.deleteFramebuffer(frame);}
    programs=[];textures=[];frame=null;
    if(gl && !gl.isContextLost())gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  function init(){
    gl=canvas.getContext("webgl2",{alpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});
    if(!gl || !gl.getExtension("EXT_color_buffer_float"))throw Error("Float render target unavailable");
    function program(fragment:string){
      const p=gl!.createProgram()!;
      const shaders=[vertex,fragment].map((source,i)=>{const s=gl!.createShader(i?gl!.FRAGMENT_SHADER:gl!.VERTEX_SHADER)!;gl!.shaderSource(s,source);gl!.compileShader(s);return s;});
      for(const s of shaders)gl!.attachShader(p,s);gl!.linkProgram(p);for(const s of shaders)gl!.deleteShader(s);
      if(!gl!.getProgramParameter(p,gl!.LINK_STATUS)){gl!.deleteProgram(p);throw Error("Heat shader unavailable");}
      programs.push(p);
    }
    program(horizontal);program(vertical);
    for(let i=0;i<3;i++){
      const t=gl.createTexture()!;textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    }
    const palette=new Uint8Array(256*4);for(let i=0;i<256;i++){palette.set(heatColor(i/255),i*4);palette[i*4+3]=255;}
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,palette);
    frame=gl.createFramebuffer();gl.disable(gl.BLEND);
    canvas.addEventListener("webglcontextlost",dispose,{once:true});
  }
  return {
    dispose,
    draw(ctx:CanvasRenderingContext2D,data:DistributionRaster,w:number,h:number){
      if(failed)return false;
      try{
        if(!gl)init();const g=gl!;
        if(g.isContextLost()){dispose();return false;}
        if(key!==data.key){
          const {width:dw,height:dh,sigma}=data;
          // Raster sigma is bounded by 3, so its exact finite radius fits 19 taps.
          if(sigma>3 || sigma<=0)return false;
          if(dw!==width || dh!==height){
            canvas.width=width=dw;canvas.height=height=dh;
            g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,textures[1]);
            g.texImage2D(g.TEXTURE_2D,0,g.R32F,dw,dh,0,g.RED,g.FLOAT,null);
            g.bindFramebuffer(g.FRAMEBUFFER,frame);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,textures[1],0);
            if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw Error("Float target incomplete");
          }
          const radius=Math.ceil(3*sigma),weights=new Float32Array(19);let total=0;
          for(let i=-radius;i<=radius;i++)total+=weights[i+9]=Math.exp(-.5*(i/sigma)**2);
          for(let i=0;i<19;i++)weights[i]/=total;
          g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,textures[0]);
          g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,true);g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
          g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,data.canvas);
          g.viewport(0,0,dw,dh);
          for(let i=0;i<2;i++){
            const p=programs[i];g.useProgram(p);g.bindFramebuffer(g.FRAMEBUFFER,i===0?frame:null);
            g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,textures[i]);
            g.uniform1i(g.getUniformLocation(p,"image"),0);g.uniform1i(g.getUniformLocation(p,"radius"),radius);
            g.uniform2i(g.getUniformLocation(p,"size"),dw,dh);g.uniform1fv(g.getUniformLocation(p,"weights[0]"),weights);
            if(i===1){g.activeTexture(g.TEXTURE1);g.bindTexture(g.TEXTURE_2D,textures[2]);g.uniform1i(g.getUniformLocation(p,"palette"),1);}
            g.drawArrays(g.TRIANGLES,0,3);
          }
          if(g.getError()!==g.NO_ERROR)throw Error("Heat render failed");
          key=data.key;
        }
        ctx.drawImage(canvas,0,0,w,h);return true;
      }catch{dispose();return false;}
    },
  };
}
