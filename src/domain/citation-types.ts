import type {AnswerReference,CitationType,ReferenceChannel} from "./types";
import type {Asset} from "./datasets";
import type {Observation} from "./push-observations";

export const citationTypeLabels:Record<CitationType,string>={data:"本地数据集",paper:"文献依据",web:"网页来源"};
const channelTypes:Record<ReferenceChannel,CitationType>={local:"data",assertion:"paper",web:"web"};
type CitationAsset=Pick<Asset,"holding"|"origins"|"datasetId">;
/** Source groups follow acquisition, never a paper URL, DOI or dataset title. */
export function referenceChannel(ref:AnswerReference,asset?:CitationAsset,observation?:Pick<Observation,"file"|"measurements">):ReferenceChannel {
  if(ref.kind==="web")return "web";
  if(/^earthnano:[a-f0-9]{64}$/.test(ref.id))return "assertion";
  if(ref.sourceChannel && Object.hasOwn(channelTypes,ref.sourceChannel))return ref.sourceChannel;
  if(asset?.holding || asset?.origins.includes("haina") || ref.id.startsWith("haina:") || observation?.file || observation?.measurements?.length)return "local";
  if(asset?.origins.includes("paper"))return "assertion";
  return "web";
}
export function referenceCitationType(ref:AnswerReference,asset?:CitationAsset,observation?:Pick<Observation,"file"|"measurements">):CitationType {
  return channelTypes[referenceChannel(ref,asset,observation)];
}
/** Document metadata used by retrieval planning, not by citation source grouping. */
export function webDocumentType(value:{url:string;referenceType?:CitationType}):CitationType{
  if(value.referenceType && Object.hasOwn(citationTypeLabels,value.referenceType))return value.referenceType;
  let url:URL;try{url=new URL(value.url);}catch{return "web";}
  if(!/^https?:$/.test(url.protocol) || url.username || url.password)return "web";
  const host=url.hostname.toLowerCase(),p=url.pathname;
  const within=(domain:string)=>host===domain || host.endsWith("."+domain);
  if((within("copernicus.org") && /^\/articles\/[\w.-]+\/\d+\/\d{4}(?:\/|$)/.test(p)) ||
    (within("mdpi.com") && /^\/\d{4}-[\dX]{4}\/\d+\/\d+\/\d+(?:\/|$)/i.test(p)) ||
    (within("nature.com") && /^\/articles\/s\d[\w.-]*/.test(p)) ||
    (host==="link.springer.com" && /^\/article\/10\.\d+\//.test(p)) ||
    (within("frontiersin.org") && /^\/(?:journals\/[^/]+\/)?articles\/10\.\d+\//.test(p)) ||
    (within("science.org") && /^\/doi\/(?:full\/|abs\/)?10\.\d+\//.test(p)) ||
    (within("onlinelibrary.wiley.com") && /^\/doi\/(?:full\/|abs\/|epdf\/)?10\.\d+\//.test(p)) ||
    (host==="journals.plos.org" && /^\/[^/]+\/article$/.test(p) && /^10\.\d+\//.test(url.searchParams.get("id")||"")))return "paper";
  return "web";
}
