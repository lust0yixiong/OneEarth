export interface ChatModel {
  executor: "codex" | "claude";
  model: string;
  provider?: "native" | "deepseek" | "custom";
  endpoint?: string;
}
export const defaultChatModel: ChatModel = { executor:"codex", model:"deepseek-flash", provider:"deepseek" };
/** Empty native Codex choices follow the OneEarth deployment default. */
export function resolvedChatModel(config: ChatModel): ChatModel {
  return config.executor === "codex" && (!config.provider || config.provider === "native") && !config.model
    ? {...config, model:"gpt-6-luna"}
    : config;
}
export function validChatModel(value: unknown): value is ChatModel {
  const v = value as Partial<ChatModel> | null;
  if (v?.provider && !["native","deepseek","custom"].includes(v.provider)) return false;
  if (v?.provider === "custom") {
    try {
      const url=new URL(v.endpoint || "");
      if (url.username || url.password || url.search || url.hash || !(url.protocol==="https:" || (url.protocol==="http:" && ["localhost","127.0.0.1","[::1]"].includes(url.hostname)))) return false;
    } catch { return false; }
  }
  return !!v && (v.executor === "codex" || v.executor === "claude") &&
    typeof v.model === "string" && /^(?:[a-zA-Z0-9][a-zA-Z0-9_./:\[\]-]{0,99})?$/.test(v.model);
}
const key = "oneearth.chat-model.v1";
export function readChatModel(): ChatModel {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null");
    return validChatModel(stored) ? resolvedChatModel(stored) : defaultChatModel;
  } catch { return defaultChatModel; }
}
export function rememberedModel(executor: ChatModel["executor"]): string {
  try {
    const stored = localStorage.getItem(key+"."+executor);
    return resolvedChatModel({executor,model:validChatModel({executor,model:stored}) ? stored! : ""}).model;
  } catch { return resolvedChatModel({executor,model:""}).model; }
}
export function saveChatModel(value: ChatModel, models: Record<ChatModel["executor"],string>) {
  if(!value.provider || value.provider==="native")localStorage.setItem(key+"."+value.executor,models[value.executor]);
  localStorage.setItem(key+"."+value.executor+"."+(value.provider || "native"),JSON.stringify(value));
  localStorage.setItem(key, JSON.stringify(value));
}

export function rememberedService(executor:ChatModel["executor"],provider:ChatModel["provider"]):ChatModel {
  try {
    const saved=JSON.parse(localStorage.getItem(key+"."+executor+"."+provider)||"null");
    if(validChatModel(saved))return resolvedChatModel(saved);
  } catch { /* Use defaults for a new configuration. */ }
  return {executor,provider,model:provider==="deepseek"?"deepseek-flash":provider==="native"?rememberedModel(executor):""};
}
