import {BookOpen,Database,Globe} from "lucide-react";
import type {CitationType} from "../domain/types";

export function CitationIcon({type,size=13,className}:{type:CitationType;size?:number;className?:string}) {
  const Icon=type==="data"?Database:type==="paper"?BookOpen:Globe;
  return <Icon size={size} strokeWidth={1.65} className={className} aria-hidden="true"/>;
}
