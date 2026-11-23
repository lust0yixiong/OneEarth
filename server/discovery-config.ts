import {validChatModel, type ChatModel} from "../src/domain/chat-model";
import type {DeepSeekTools} from "../src/domain/deepseek-tools";

export type DiscoveryConfiguration = {
  kind: "configured";
  model: ChatModel;
  tools: DeepSeekTools;
} | {
  kind: "missing" | "invalid";
  issue: string;
};

export function discoveryConfiguration(env = process.env): DiscoveryConfiguration {
  const name = "ONEEARTH_DISCOVERY_CHAT_MODEL";
  const raw = env[name];
  if (raw === undefined) return {kind:"missing", issue:name + " 未配置。"};
  try {
    const model: unknown = JSON.parse(raw);
    if (!validChatModel(model) || Object.keys(model).some(key => !["executor","model","provider"].includes(key)) ||
      (model.provider !== undefined && model.provider !== "native" && model.provider !== "deepseek"))
      return {kind:"invalid", issue:name + " 须指定已授权的 native 或 DeepSeek 模型。"};
    if (!model.model) return {kind:"invalid", issue:name + " 缺少模型名称。"};
    if (model.provider === "deepseek" && !env.DEEPSEEK_API_KEY?.trim())
      return {kind:"invalid", issue:"发现服务选用了 DeepSeek 模型，但缺少部署凭据。"};
    return {
      kind:"configured",
      model:{executor:model.executor, model:model.model, provider:model.provider ?? "native"},
      tools:{search:env.ONEEARTH_DEEPSEEK_SEARCH === "true",
        fetch:env.ONEEARTH_DEEPSEEK_FETCH === "true"},
    };
  } catch {
    return {kind:"invalid", issue:name + " 不是有效的模型 JSON。"};
  }
}

export function allowedDiscoveryTools(request: DeepSeekTools | undefined, local: DeepSeekTools): DeepSeekTools {
  return {search:request?.search === true && local.search, fetch:request?.fetch === true && local.fetch};
}
