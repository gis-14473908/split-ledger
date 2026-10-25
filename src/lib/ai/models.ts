import type { ModelKey } from "../db/types";

export type { ModelKey };

export const MODEL_KEYS: readonly ModelKey[] = ["haiku", "sonnet", "opus"];

export const MODEL_IDS: Record<ModelKey, string> = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

export const MODEL_LABEL: Record<ModelKey, string> = {
  haiku: "Haiku 5.5",
  sonnet: "Sonnet 5.5",
  opus: "Opus 5.5",
};

export function isModelKey(x: unknown): x is ModelKey {
  return typeof x === "string" && (MODEL_KEYS as readonly string[]).includes(x);
}
