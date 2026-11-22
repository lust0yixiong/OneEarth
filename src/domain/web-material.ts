export type WebMaterial = {kind:"metadata"|"catalogue"|"data-service"|"file-access"; label:string};

/** Service route semantics only. This does not inspect or confirm a response. */
export function webMaterial(raw:string):WebMaterial|undefined {
  let url:URL;
  try { url=new URL(raw); } catch { return; }
  if (!["http:","https:"].includes(url.protocol) || url.username || url.password) return;
  const route=/(?:^|\/)thredds\/(iso|ncml|uddc|catalog|dodsC|dap4|ncss|wcs|wms|fileServer)(?=\/|\.html$|$)/i.exec(url.pathname)?.[1].toLowerCase();
  switch (route) {
    case "iso": return {kind:"metadata",label:"THREDDS ISO 19115 元数据"};
    case "ncml": return {kind:"metadata",label:"THREDDS NcML 元数据"};
    case "uddc": return {kind:"metadata",label:"THREDDS 数据集元数据评价"};
    case "catalog": return {kind:"catalogue",label:"THREDDS 数据目录"};
    case "dodsc": return {kind:"data-service",label:"THREDDS OPeNDAP 数据服务"};
    case "dap4": case "ncss": case "wcs": case "wms":
      return {kind:"data-service",label:"THREDDS "+route.toUpperCase()+" 数据服务"};
    case "fileserver": return {kind:"file-access",label:"THREDDS 文件访问端点"};
  }
}

// Match the Markdown links rendered by Chat. The immediately preceding
// "…入口：" label often carries the actual assertion.
const code=/(?:```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;
const materialLink=new RegExp("("+code.source+")|"+/(\*{0,2}(?:原始(?:数据)?文件(?:下载)?|原始数据下载|直接下载|数据下载|OPeNDAP(?: 数据服务)?)(?:入口|链接|地址)?\*{0,2}\s*[:：]\*{0,2}\s*)?\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.source,"gi");
const directAccess=/原始(?:数据)?文件|原始数据下载|直接下载|数据下载|(?:下载|download)\s*(?:数据文件|原始数据|文件|NetCDF|GeoTIFF)|(?:NetCDF|GeoTIFF).*(?:文件|下载)|\b(?:raw file|direct download|file download)\b/i;

function claimedKind(prefix:string,label:string):"file-access"|"data-service"|undefined {
  if (directAccess.test(prefix)) return "file-access";
  if (/OPeNDAP/i.test(prefix)) return "data-service";
  if (/元数据|目录|metadata|catalogue|catalog/i.test(label)) return;
  if (/OPeNDAP/i.test(label)) return "data-service";
  if (directAccess.test(label) || /^(?:下载(?:入口|链接|地址)?|download)$/i.test(label.trim())) return "file-access";
}

export function withoutAnswerCode(text:string) {
  return text.replace(code,"");
}

export function webMaterialLinks(text:string) {
  return Array.from(text.matchAll(materialLink)).flatMap(([literal,code,prefix="",label,url])=>{
    if (code) return [];
    const claimed=claimedKind(prefix,label), material=webMaterial(url);
    return [{literal,prefix,label,url,claimed,material,conflict:!!claimed && !!material && claimed!==material.kind}];
  });
}

/** Keep the original destination when displaying older saved answers. */
export function materialLinkDisplay(text:string):string {
  return text.replace(materialLink,(literal,code,prefix="",label,url)=>{
    if (code) return literal;
    const material=webMaterial(url);
    const claimed=claimedKind(prefix,label);
    return claimed && material && claimed!==material.kind ? "["+material.label+"]("+url+")" : literal;
  });
}
