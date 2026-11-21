// Camera stays on the sphere at every magnification. Anchor correction holds the
// longitude/latitude under the pointer while the projected radius changes.
export const zoomBands=[1,2.6,6.9,18.3,48.5,128.5];
export const areas=[86801.8,12393.4,1770.35,252.9,36.13,5.16];
export const edgeKm=[182.51,68.98,26.07,9.85,3.72,1.41];
export function resolution(z){return 2+zoomBands.reduce((n,t)=>n+(z>=t-.00001),-1);}
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const wrap=n=>((n+180)%360+360)%360-180;
export function navigation({canvas,root,getCamera,setCamera,getScale,baseRadius,pick,stopFlight,getOrigin=()=>[canvas.clientWidth/2,canvas.clientHeight/2]}){
  const pointers=new Map();
  let moved=false,pinch=null;
  const coords=e=>{const b=canvas.getBoundingClientRect();return [e.clientX-b.left,e.clientY-b.top];};
  function ray(point,z,center){
    const R=baseRadius()*z;
    const [originX,originY]=getOrigin();
    const x=(point[0]-originX)/R,y=(originY-point[1])/R;
    if(x*x+y*y>=1)return null;
    const depth=Math.sqrt(1-x*x-y*y),lat=center[1]*Math.PI/180;
    return [wrap(center[0]+Math.atan2(x,depth*Math.cos(lat)-y*Math.sin(lat))*180/Math.PI),
      Math.asin(clamp(y*Math.cos(lat)+depth*Math.sin(lat),-1,1))*180/Math.PI];
  }
  function anchor(point,z,center,target){
    if(!target)return center;
    let [lon,lat]=center;
    for(let i=0;i<5;i++){
      const under=ray(point,z,[lon,lat]);if(!under)break;
      lon=wrap(lon+wrap(target[0]-under[0]));lat=clamp(lat+target[1]-under[1],-89.9,89.9);
    }
    return [lon,lat];
  }
  function scaleTo(next,point){
    const old=getScale(),z=clamp(next,1,2200);stopFlight();
    const center=getCamera();
    const fixed=point&&ray(point,old,center);
    setCamera(z,fixed?anchor(point,z,center,fixed):center);
  }
  function step(sign){
    const levels=[...zoomBands,340,900,2200],z=getScale();
    scaleTo(sign>0?(levels.find(v=>v>z+.001)||2200):([ ...levels ].reverse().find(v=>v<z-.001)||1));
  }
  root.querySelector('[data-plus]').onclick=()=>step(1);
  root.querySelector('[data-minus]').onclick=()=>step(-1);
  root.querySelector('[data-reset]').onclick=()=>{stopFlight();setCamera(1,[100,23]);};
  const wheel=e=>{
    e.preventDefault();
    const dy=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1);
    scaleTo(getScale()*Math.exp(-clamp(dy,-350,350)*(e.ctrlKey?.009:.003)),coords(e));
  };
  canvas.addEventListener('wheel',wheel,{passive:false});
  canvas.ondblclick=e=>{e.preventDefault();scaleTo(getScale()*2.65,coords(e));};
  canvas.onpointerdown=e=>{
    if(e.button!==0)return;
    stopFlight();const pos=coords(e);
    pointers.set(e.pointerId,{start:pos,pos,camera:[...getCamera()]});
    canvas.setPointerCapture(e.pointerId);
    if(pointers.size===1){moved=false;pinch=null;}
    if(pointers.size===2){
      const [a,b]=[...pointers.values()].map(p=>p.pos);
      const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      pinch={distance:Math.max(1,Math.hypot(a[0]-b[0],a[1]-b[1])),scale:getScale(),camera:getCamera(),target:ray(mid,getScale(),getCamera())};
      moved=true;
    }
  };
  canvas.onpointermove=e=>{
    const pointer=pointers.get(e.pointerId);if(!pointer)return;
    pointer.pos=coords(e);
    if(pointers.size>=2&&pinch){
      const [a,b]=[...pointers.values()].map(p=>p.pos);
      const z=clamp(pinch.scale*Math.hypot(a[0]-b[0],a[1]-b[1])/pinch.distance,1,2200);
      setCamera(z,anchor([(a[0]+b[0])/2,(a[1]+b[1])/2],z,pinch.camera,pinch.target));return;
    }
    const dx=pointer.pos[0]-pointer.start[0],dy=pointer.pos[1]-pointer.start[1];
    if(Math.hypot(dx,dy)>4)moved=true;
    if(!moved)return;
    const deg=180/(Math.PI*baseRadius()*getScale());
    const [lon,lat]=pointer.camera;
    setCamera(getScale(),[wrap(lon-dx*deg/Math.max(.12,Math.cos(lat*Math.PI/180))),clamp(lat+dy*deg,-89.9,89.9)]);
  };
  function release(e,cancelled){
    if(!pointers.delete(e.pointerId))return;
    const pos=coords(e);
    if(!cancelled&&!moved&&pointers.size===0&&pos[0]>=0&&pos[1]>=0&&pos[0]<=canvas.clientWidth&&pos[1]<=canvas.clientHeight)pick(...pos,e.pointerType==='touch');
    if(pointers.size===1){const p=[...pointers.values()][0];p.start=p.pos;p.camera=[...getCamera()];pinch=null;moved=true;}
  }
  canvas.onpointerup=e=>release(e,false);
  canvas.onpointercancel=canvas.onlostpointercapture=e=>release(e,true);
  return {step,scaleTo,dispose(){canvas.removeEventListener('wheel',wheel);canvas.onpointerdown=canvas.onpointermove=canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=canvas.ondblclick=null;for(const selector of ['[data-plus]','[data-minus]','[data-reset]'])root.querySelector(selector).onclick=null;}};
}
