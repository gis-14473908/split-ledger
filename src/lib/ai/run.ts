import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod";
import { AiError } from "./errors";
import { MOCKS } from "./mock";
import { MODEL_IDS, type ModelKey } from "./models";

export { AiError };

let client: Anthropic | null = null;

type RunOptions<T> = {
  model: ModelKey;
  system: string;
  content: Anthropic.Beta.Messages.BetaContentBlockParam[];
  schema: z.ZodType<T>;
  mockKey: "statement" | "receipt" | "categorize";
  /** Only used by the categorize mock. */
  mockCount?: number;
};

/** One structured-output call to Claude. Retries once if the answer doesn't parse. */
export async function runStructured<T>(o: RunOptions<T>): Promise<T> {
  if (process.env.AI_MOCK === "1") {
    return (o.mockKey === "categorize" ? MOCKS.categorize(o.mockCount ?? 0) : MOCKS[o.mockKey]()) as T;
  }
  client ??= new Anthropic();

  for (let attempt = 0; attempt < 2; attempt++) {
    let message;
    try {
      message = await client.beta.messages.parse({
        model: MODEL_IDS[o.model],
        max_tokens: 16000,
        system: o.system,
        messages: [{ role: "user", content: o.content }],
        output_config: { effort: "medium", format: betaZodOutputFormat(o.schema) },
        // Sonnet and Opus can hand a refused request to another model server-side.
        ...(o.model === "haiku" ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
      });
    } catch (e) {
      if (e instanceof Anthropic.APIError) throw new AiError("upstream");
      continue; // the answer did not match the schema; try once more
    }
    if (message.stop_reason === "refusal") throw new AiError("refused");
    if (message.parsed_output != null) return message.parsed_output as T;
  }
  throw new AiError("invalid_output");
}
