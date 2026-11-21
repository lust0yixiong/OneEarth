import {geoInterpolate} from "d3-geo";
import type {Camera,Coordinate} from "./types";
/** Great-circle rotation avoids flying the long way around the date line. */
export function flightCamera(from:Camera,to:Camera,t:number):Camera {
  if(t>=1)return to;
  const k=Math.max(0,Math.min(1,t)),ease=k*k*(3-2*k);
  return {center:geoInterpolate(from.center,to.center)(ease) as Coordinate,
    zoom:Math.exp(Math.log(from.zoom)+(Math.log(to.zoom)-Math.log(from.zoom))*ease),reason:to.reason};
}
