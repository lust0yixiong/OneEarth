import {BoundingRectangle, Color, Material, ViewportQuad, type Scene} from "cesium";

/** Compose the case's projected symbols and animation into its Cesium frame. */
export function createCesiumObservationOverlay(scene:Scene,canvas:HTMLCanvasElement,layers:HTMLCanvasElement[]) {
  const buffers=[document.createElement("canvas"),document.createElement("canvas")];
  const contexts=buffers.map(buffer=>buffer.getContext("2d")!);
  const material=Material.fromType(Material.ImageType,{image:buffers[0],color:Color.TRANSPARENT});
  const quad=scene.primitives.add(new ViewportQuad(new BoundingRectangle(),material));
  quad.show=false;
  let index=0,frames=0,pending:(()=>void)|undefined,queued:(()=>void)|undefined;

  function upload(){
    if(frames||!queued||!canvas.clientWidth||!canvas.clientHeight||!layers[0]?.width||!layers[0].height)return;
    pending=queued;
    queued=undefined;
    index=1-index;
    const buffer=buffers[index],ctx=contexts[index];
    const scale=Math.min(1,1536/Math.max(layers[0].width,layers[0].height));
    const width=Math.ceil(layers[0].width*scale),height=Math.ceil(layers[0].height*scale);
    if(buffer.width!==width)buffer.width=width;
    if(buffer.height!==height)buffer.height=height;
    ctx.clearRect(0,0,width,height);
    for(const layer of layers)if(layer.width&&layer.height)ctx.drawImage(layer,0,0,width,height);
    material.uniforms.image=buffer;
    frames=2;
    quad.show=true;
    scene.requestRender();
  }
  const removeResize=scene.preRender.addEventListener(()=>{
    quad.rectangle.width=canvas.width;
    quad.rectangle.height=canvas.height;
  });
  const removePostRender=scene.postRender.addEventListener(()=>{
    if(!frames)return;
    if(--frames){
      material.uniforms.color=Color.WHITE;
      scene.requestRender();
      return;
    }
    pending?.();
    pending=undefined;
    upload();
  });
  return {
    present(observed:()=>void){
      queued=observed;
      upload();
    },
    dispose(){
      pending=queued=undefined;
      removeResize();
      removePostRender();
      scene.primitives.remove(quad);
      material.destroy();
    },
  };
}
