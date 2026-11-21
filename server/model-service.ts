import { validChatModel, type ChatModel } from "../src/domain/chat-model";

// Keys entered in Settings live only in this server process and are scoped to their destination.
const credentials = new Map<string,string>();
function destination(config:ChatModel) {
  return config.provider === "deepseek" ? "https://api.deepseek.com" : config.endpoint!.replace(/\/+$/,"");
}
export function setServiceKey(config:ChatModel,key:string) {
  credentials.set(destination(config),key);
}
export function deepSeekKey() {
  return credentials.get("https://api.deepseek.com") || process.env.DEEPSEEK_API_KEY;
}
function serviceKey(config:ChatModel) {
  const value=config.provider==="deepseek" ? deepSeekKey() : credentials.get(destination(config));
  if(!value) throw Error("请先为此模型服务设置 API Key。");
  return value;
}
export async function serviceModels(config:ChatModel) {
  const base=destination(config);
  const key=serviceKey(config);
  const headers:Record<string,string> = config.provider==="custom" && config.executor==="claude"
    ? {"x-api-key":key,"anthropic-version":"2023-06-01"} : {authorization:"Bearer "+key};
  const response=await fetch(base+(config.provider==="deepseek"?"":config.executor==="claude" && !base.endsWith("/v1")?"/v1":"")+"/models",{headers,redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error("模型服务读取失败（HTTP "+response.status+"），请核对地址和密钥。");
  const result=await response.json();
  if(!Array.isArray(result.data))throw Error("服务未提供模型清单，可使用自定义模型名称。");
  return result.data.filter((r:{id?:string})=>r?.id && validChatModel({...config,model:r.id}))
    .map((r:{id:string;display_name?:string})=>({id:r.id,label:r.display_name || r.id}));
}
export function configureService(config:ChatModel,args:string[],env:NodeJS.ProcessEnv) {
  if(!config.provider || config.provider==="native")return;
  const key=serviceKey(config);
  const base=destination(config);
  if(config.executor==="codex"){
    env.ONEEARTH_EXECUTOR_KEY=key;
    args.push("-c",'model_provider="oneearth_service"',"-c",'model_providers.oneearth_service.name="OneEarth"',
      "-c","model_providers.oneearth_service.base_url="+JSON.stringify(base),
      "-c",'model_providers.oneearth_service.wire_api="responses"',"-c",'model_providers.oneearth_service.env_key="ONEEARTH_EXECUTOR_KEY"');
  } else {
    // Bare mode skips local auth helpers, hooks and user provider overrides.
    args.splice(args.indexOf("--safe-mode"),1,"--bare");
    args[args.indexOf("--setting-sources")+1]="";
    for(const name of Object.keys(env)) if(name.startsWith("ANTHROPIC_") || name.startsWith("CLAUDE_CODE_USE_") || name==="CLAUDE_CODE_OAUTH_TOKEN")delete env[name];
    env.ANTHROPIC_BASE_URL=config.provider==="deepseek"?base+"/anthropic":base;
    env.ANTHROPIC_API_KEY=key;
    env.ANTHROPIC_MODEL=config.model;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL=config.model;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL=config.model;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL=config.model;
  }
}
