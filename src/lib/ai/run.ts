import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type * as z from "zod";
import type { ApiFormat } from "./catalog";
import { AiError } from "./errors";
import { MOCKS } from "./mock";

export { AiError };

export type ResolvedSource = {
  kind: "builtin" | "custom";
  apiFormat: ApiFormat;
  model: string;
  apiKey: string;
  baseURL?: string;
  label: string;
  allowServerFallback: boolean;
};

export type RunResult<T> = { parsed: T; usage: { inputTokens: number; outputTokens: number } };

type RunOptions<T> = {
  source: ResolvedSource;
  system: string;
  content: Anthropic.Beta.Messages.BetaContentBlockParam[];
  schema: z.ZodType<T>;
  mockKey: "statement" | "receipt" | "categorize";
  /** Only used by the categorize mock. */
  mockCount?: number;
};

/** Convert Anthropic-style content blocks (base64 images + text) to OpenAI chat parts. */
export function toOpenAiContent(
  blocks: Anthropic.Beta.Messages.BetaContentBlockParam[],
): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  for (const b of blocks) {
    if (b.type === "text") {
      parts.push({ type: "text", text: b.text });
    } else if (b.type === "image" && b.source.type === "base64") {
      parts.push({ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
    }
  }
  return parts;
}

/** One structured-output call. Retries once if the answer doesn't parse. */
export async function runStructured<T>(o: RunOptions<T>): Promise<RunResult<T>> {
  if (process.env.AI_MOCK === "1") {
    const parsed = (o.mockKey === "categorize" ? MOCKS.categorize(o.mockCount ?? 0) : MOCKS[o.mockKey]()) as T;
    return { parsed, usage: { inputTokens: 0, outputTokens: 0 } };
  }
  return o.source.apiFormat === "openai" ? runOpenAi(o) : runAnthropic(o);
}

async function runAnthropic<T>(o: RunOptions<T>): Promise<RunResult<T>> {
  const { source } = o;
  const client = new Anthropic({ apiKey: source.apiKey, ...(source.baseURL ? { baseURL: source.baseURL } : {}) });

  for (let attempt = 0; attempt < 2; attempt++) {
    let message;
    try {
      message = await client.beta.messages.parse({
        model: source.model,
        max_tokens: 16000,
        system: o.system,
        messages: [{ role: "user", content: o.content }],
        output_config: { effort: "medium", format: betaZodOutputFormat(o.schema) },
        // Built-in Sonnet and Opus can hand a refused request to another model server-side.
        ...(source.allowServerFallback
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      });
    } catch (e) {
      if (e instanceof Anthropic.APIError) throw new AiError("upstream");
      continue; // the answer did not match the schema; try once more
    }
    if (message.stop_reason === "refusal") throw new AiError("refused");
    if (message.parsed_output != null) {
      return {
        parsed: message.parsed_output as T,
        usage: { inputTokens: message.usage?.input_tokens ?? 0, outputTokens: message.usage?.output_tokens ?? 0 },
      };
    }
  }
  throw new AiError("invalid_output");
}

async function runOpenAi<T>(o: RunOptions<T>): Promise<RunResult<T>> {
  const { source } = o;
  const client = new OpenAI({ apiKey: source.apiKey, baseURL: source.baseURL });

  for (let attempt = 0; attempt < 2; attempt++) {
    let completion;
    try {
      completion = await client.chat.completions.parse({
        model: source.model,
        messages: [
          { role: "system", content: o.system },
          { role: "user", content: toOpenAiContent(o.content) },
        ],
        response_format: zodResponseFormat(o.schema as z.ZodType, "out"),
      });
    } catch (e) {
      if (e instanceof OpenAI.APIError) throw new AiError("upstream");
      continue; // the answer did not match the schema; try once more
    }
    const choice = completion.choices[0];
    if (choice?.message?.refusal || choice?.finish_reason === "content_filter") throw new AiError("refused");
    const parsed = choice?.message?.parsed;
    if (parsed != null) {
      return {
        parsed: parsed as T,
        usage: {
          inputTokens: completion.usage?.prompt_tokens ?? 0,
          outputTokens: completion.usage?.completion_tokens ?? 0,
        },
      };
    }
  }
  throw new AiError("invalid_output");
}
