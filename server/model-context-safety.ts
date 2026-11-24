const sensitiveParameter=/^(?:sig|sign|signature|token|access[_-]?token|refresh[_-]?token|auth(?:orization)?|api[_-]?key|key|secret|credential|expires?|expiretime|expiry|policy|key-pair-id|session(?:id|token)?|awsaccesskeyid|ossaccesskeyid|x-amz-.+|x-goog-.+|x-oss-.+)$/i;
const credentialAssignment=/(\b(?:token|secret|password|api[_-]?key|aws_secret_access_key)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)([a-z0-9._~+\/=\-]{3,}|〔\d+〕)/giu;
const safeReference=/^(?:[SLDW]\d+|〔\d+〕)$/;
const privateFile=/^(?:file:|\/(?:Users|home|private|var|tmp|Volumes)\/|[a-z]:\\(?:Users|Documents|Windows|Temp)\\)/i;

/** Public locator only. This never replaces the URL retained for an authorized read. */
export function modelUrlLocator(raw:string){
  try{
    let decoded=raw;
    for(let pass=0;pass<8;pass++){
      const next=decoded.replace(/&(?:amp|#0*38|#x0*26);/giu,"&");if(next===decoded)break;decoded=next;
    }
    const url=new URL(decoded);if(!["https:","http:"].includes(url.protocol))return raw;
    url.username="";url.password="";
    const azureSigned=[...url.searchParams.keys()].some(key=>/^sig$/i.test(key));
    if(/&(?:amp|#)/iu.test(decoded))url.search="";
    for(const [key,value] of [...url.searchParams])if(sensitiveParameter.test(key)||azureSigned&&/^(?:se|sv|sp|sr|st|spr|sip|skoid|sktid|skt|ske|sks|skv)$/i.test(key)||privateFile.test(value)||
      /(?:[?&;]|&(?:amp|#\d+|#x[\da-f]+);)(?:sig|sign(?:ature)?|token|access[_-]?token|auth|x-amz-[\w-]+)\s*=/iu.test(value))url.searchParams.delete(key);
    if(url.hash&&!/^#page=\d+$/i.test(url.hash))url.hash="";
    return url.href;
  }catch{return raw;}
}

/** Used for every runtime model prompt and its diagnostic projection. */
export function modelSafeText(value:string):string{
  return value.replace(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/gu,"[redacted private key]")
    .replace(/\bsk-[a-z0-9_-]{8,}\b/giu,"[redacted key]").replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,"[redacted access key]")
    .replace(/https?:\/\/[^\s<>"'\\]+/giu,raw=>{
    const suffix=raw.match(/[),.;!?\]}]+$/u)?.[0]||"",url=suffix?raw.slice(0,-suffix.length):raw;
    return modelUrlLocator(url)+suffix;
  }).replace(credentialAssignment,(_all,prefix:string,credential:string)=>prefix+(safeReference.test(credential)?credential:"[redacted]"))
    .replace(/(\bAuthorization(?:\\?["'])?\s*[:=]?\s*(?:\\?["'])?(?:Bearer|Basic)\s+)[a-z0-9._~+\/=\-]+/giu,"$1[redacted]")
    .replace(/\bBearer\s+[a-z0-9._~+\/=\-]+/giu,"Bearer [redacted]")
    .replace(/(\b(?:x-api-key|api_key)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)[^\s"'\\,}]+/giu,"$1[redacted]")
    .replace(/file:\/\/[^\r\n"'<>]+/giu,"[private file]")
    .replace(/(^|[\s("'`=:])\/(?:Users|home|private|var|tmp|Volumes)\/[^\r\n"'<>]+/gmu,"$1[private file]")
    .replace(/[a-z]:\\{1,2}(?:Users|Documents|Windows|Temp)\\[^\r\n"'<>]+/giu,"[private file]");
}

export function modelSafeValue<T>(value:T):T{
  if(typeof value==="string")return modelSafeText(value) as T;
  if(Array.isArray(value))return value.map(item=>modelSafeValue(item)) as T;
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
    /^(?:authorization|proxy-authorization|x-api-key|api_key)$/i.test(key)?"[redacted]":modelSafeValue(item)])) as T;
  return value;
}

/** Reverse only an unambiguous key already present in the authorized inventory. */
export function originalModelKey(key:unknown,allowed:string[]):string|undefined{
  if(typeof key!=="string")return;
  const matches=allowed.filter(value=>value===key||modelSafeText(value)===key);
  return matches.length===1?matches[0]:undefined;
}

/** Fails closed without echoing any rejected text into logs or a user reply. */
export function assertModelContextSafe(text:string):void{
  if(modelSafeText(text)!==text||
    /\bAuthorization(?:\\?["'])?\s*[:=]?\s*(?:\\?["'])?(?:Bearer|Basic)\s+(?!\[redacted\])[^\s"']+/iu.test(text)||
    /(?:\?|&|&(?:amp|#\d+|#x[\da-f]+);)(?:amp;)*(?:sig|sign(?:ature)?|token|access[_-]?token|x-amz-[\w-]+)\s*=/iu.test(text)||
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\bsk-[a-z0-9_-]{8,}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/iu.test(text))
    throw Error("Model context contains unsafe private or signed data.");
}
