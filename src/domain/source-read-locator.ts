export const sourceReadLocatorKinds = ["section","table","figure","page","equation"] as const;
export type SourceReadLocator = {kind:typeof sourceReadLocatorKinds[number];value:string};
export type AvailableSourceLocator = SourceReadLocator & {label?:string;href?:string};
export type SourceReadLocatorResult = AvailableSourceLocator & {
  status:"found"|"partial"|"not_found"|"unsupported";
  excerpt?:string;
};

export function parseSourceReadLocator(value:unknown):SourceReadLocator|undefined {
  if(!value || typeof value!=="object" || Array.isArray(value) ||
    Object.keys(value).some(key=>key!=="kind"&&key!=="value"))return;
  const x=value as {kind?:unknown;value?:unknown};
  if(!sourceReadLocatorKinds.some(kind=>kind===x.kind)||typeof x.value!=="string"||
    x.value.length>120||/[\u0000-\u001f\u007f]|https?:|:\/\/|[<>]/i.test(x.value))return;
  const text=x.value.trim();
  if(!text||(x.kind==="page"&&!/^[1-9][0-9]{0,5}$/.test(text)))return;
  return {kind:x.kind as SourceReadLocator["kind"],value:text};
}

export function locatorHref(source:string,anchor:string|undefined){
  if(!anchor||anchor.length>200||/[\u0000-\u001f\u007f]/.test(anchor))return;
  const url=new URL(source);
  url.hash=anchor;
  return url.href;
}

export function parseSourceReadLocators(value:unknown):SourceReadLocator[]|undefined {
  if(!Array.isArray(value)||!value.length||value.length>4)return;
  const locators=value.map(parseSourceReadLocator);
  if(!locators.every(locator=>locator!==undefined)||
    new Set(locators.map(locator=>locator.kind+"\0"+locator.value)).size!==locators.length)return;
  return locators;
}

export function validAvailableSourceLocator(input:unknown,source:string):input is AvailableSourceLocator {
  if(!input||typeof input!=="object"||Array.isArray(input))return false;
  const {kind,value,label,href}=input as AvailableSourceLocator;
  if(!parseSourceReadLocator({kind,value}) || (label!==undefined&&(typeof label!=="string"||label.length>240)))return false;
  const base=(raw:string)=>{const url=new URL(raw);url.hash="";return url.href;};
  try{return href===undefined||(typeof href==="string"&&href.length<=2500&&base(href)===base(source));}
  catch{return false;}
}

export function validSourceReadLocatorResult(value:unknown,requested:SourceReadLocator,source:string):value is SourceReadLocatorResult{
  if(!validAvailableSourceLocator(value,source))return false;
  const result=value as SourceReadLocatorResult;
  return result.kind===requested.kind&&result.value===requested.value&&
    ["found","partial","not_found","unsupported"].includes(result.status)&&
    (result.status!=="found"||typeof result.excerpt==="string"&&!!result.excerpt.trim())&&
    (result.excerpt===undefined||((result.status==="found"||result.status==="partial")&&
      typeof result.excerpt==="string"&&result.excerpt.length<=4600));
}
