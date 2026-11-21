import {createCoverageViewport} from './viewport-pool';
const viewport=createCoverageViewport();
self.onmessage=event=>{
  const {id,grid,center,cap}=event.data;
  try{self.postMessage({id,pool:viewport.prepare(grid,center,cap)});}
  catch{self.postMessage({id,error:true});}
};
