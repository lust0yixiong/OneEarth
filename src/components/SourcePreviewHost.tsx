import type {ChatLayout} from "./ChatBoundary";
import {createContext,useContext,useMemo,useState,type CSSProperties,type Dispatch,type ReactNode,type SetStateAction} from "react";
import {createPortal} from "react-dom";

type Frame=ChatLayout["frame"];
const Context=createContext<{host:HTMLElement|null;setHost:Dispatch<SetStateAction<HTMLElement|null>>;frame:Frame|null}|null>(null);

export function SourcePreviewProvider({children,frame}:{children:ReactNode;frame:Frame|null}) {
  const [host,setHost]=useState<HTMLElement|null>(null);
  const value=useMemo(()=>({host,setHost,frame}),[host,frame]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSourcePreviewHost() {
  const context=useContext(Context);
  if(!context)throw new Error("SourcePreviewProvider is required");
  return context;
}

export function SourcePreviewSurface({children}:{children:ReactNode}) {
  const {host}=useSourcePreviewHost();
  return host?createPortal(children,host):children;
}

export function usePreviewPosition(bottomInset=0):CSSProperties|undefined {
  const {frame}=useSourcePreviewHost();
  if(!frame)return;
  const margin=innerWidth<=600?8:64;
  const available=frame.x-margin-8;
  const fitsAlongside=available>=320;
  const width=fitsAlongside?Math.min(660,available):Math.min(660,innerWidth-margin-12);
  return {
    position:"fixed",left:fitsAlongside?frame.x-width-8:margin,
    top:frame.y,width,height:Math.max(180,frame.height-bottomInset),
    right:"auto",bottom:"auto",maxWidth:"none",maxHeight:"none",
  };
}
