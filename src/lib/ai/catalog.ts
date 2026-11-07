import { MODEL_KEYS, type ModelKey } from "./models";

export type ApiFormat = "anthropic" | "openai";

export type ProviderDef = {
  id: string;
  label: string;
  apiFormat: ApiFormat;
  baseURL: string | null;
  suggestedModels: { id: string; label: string }[];
  keyHint: string;
};

// verify model ids against each provider's console; they change often
export const PROVIDERS: ProviderDef[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    apiFormat: "anthropic",
    baseURL: null,
    suggestedModels: [
      { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
      { id: "claude-opus-5-5", label: "Opus 5.5" },
      { id: "claude-haiku-5-5", label: "Haiku 5.5" },
    ],
    keyHint: "在 console.anthropic.com 获取",
  },
  {
    id: "openai",
    label: "OpenAI",
    apiFormat: "openai",
    baseURL: "https://api.openai.com/v1",
    suggestedModels: [
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-5-mini", label: "GPT-5 mini" },
    ],
    keyHint: "在 platform.openai.com 获取",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    apiFormat: "openai",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    suggestedModels: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ],
    keyHint: "在 Google AI Studio 获取",
  },
  {
    id: "qwen",
    label: "通义千问 (Qwen)",
    apiFormat: "openai",
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    suggestedModels: [
      { id: "qwen3-vl-plus", label: "Qwen3-VL Plus" },
      { id: "qwen-vl-max", label: "Qwen-VL Max" },
    ],
    keyHint: "在阿里云百炼 (Model Studio) 控制台获取",
  },
  {
    id: "zhipu",
    label: "智谱 (GLM)",
    apiFormat: "openai",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    suggestedModels: [
      { id: "glm-4.6v", label: "GLM-4.6V" },
      { id: "glm-4.5v", label: "GLM-4.5V" },
    ],
    keyHint: "在 open.bigmodel.cn 获取",
  },
  {
    id: "moonshot",
    label: "月之暗面 (Kimi)",
    apiFormat: "openai",
    baseURL: "https://api.moonshot.cn/v1",
    suggestedModels: [
      { id: "kimi-latest", label: "Kimi Latest" },
      { id: "moonshot-v1-32k-vision-preview", label: "Moonshot V1 Vision" },
    ],
    keyHint: "在 platform.moonshot.cn 获取",
  },
  {
    id: "doubao",
    label: "豆包 (火山方舟)",
    apiFormat: "openai",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    suggestedModels: [
      { id: "doubao-seed-1-6-vision-250815", label: "Doubao Seed 1.6 Vision" },
    ],
    keyHint: "在火山方舟控制台获取（模型填接入点 ID 也可以）",
  },
];

export function providerById(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

// $/MTok == micro-USD/token; verify against Anthropic pricing (docs unreachable in CI)
export const PRICES: Record<ModelKey, { inMicroPerTok: number; outMicroPerTok: number }> = {
  haiku: { inMicroPerTok: 1, outMicroPerTok: 5 },
  sonnet: { inMicroPerTok: 3, outMicroPerTok: 15 },
  opus: { inMicroPerTok: 15, outMicroPerTok: 75 },
};

/** `builtin:haiku|sonnet|opus` or `custom:<id>` */
export type SourceKey = string;

export const DEFAULT_SOURCE_KEY: SourceKey = "builtin:sonnet";

export function builtinSourceKey(m: ModelKey): SourceKey {
  return `builtin:${m}`;
}

export function parseSourceKey(
  k: unknown,
): { kind: "builtin"; model: ModelKey } | { kind: "custom"; id: string } | null {
  if (typeof k !== "string") return null;
  if (k.startsWith("builtin:")) {
    const m = k.slice("builtin:".length);
    return (MODEL_KEYS as readonly string[]).includes(m) ? { kind: "builtin", model: m as ModelKey } : null;
  }
  if (k.startsWith("custom:")) {
    const id = k.slice("custom:".length);
    return id ? { kind: "custom", id } : null;
  }
  return null;
}
