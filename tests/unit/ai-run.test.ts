import { beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";

const h = vi.hoisted(() => {
  class AnthropicAPIError extends Error {}
  class OpenAIAPIError extends Error {}
  return {
    AnthropicAPIError,
    OpenAIAPIError,
    anthropicCtor: vi.fn(),
    anthropicParse: vi.fn(),
    openaiCtor: vi.fn(),
    openaiParse: vi.fn(),
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    static APIError = h.AnthropicAPIError;
    beta = { messages: { parse: h.anthropicParse } };
    constructor(opts: unknown) {
      h.anthropicCtor(opts);
    }
  }
  return { default: Anthropic };
});

vi.mock("openai", () => {
  class OpenAI {
    static APIError = h.OpenAIAPIError;
    chat = { completions: { parse: h.openaiParse } };
    constructor(opts: unknown) {
      h.openaiCtor(opts);
    }
  }
  return { default: OpenAI };
});

import { AiError, runStructured, toOpenAiContent, type ResolvedSource } from "@/lib/ai/run";

const schema = z.object({ n: z.number() });
const content = [
  { type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: "QUJD" } },
  { type: "text" as const, text: "hi" },
];
const base = { system: "sys", content, schema, mockKey: "receipt" as const };

const builtin: ResolvedSource = {
  kind: "builtin",
  apiFormat: "anthropic",
  model: "claude-sonnet-5-5",
  apiKey: "k-builtin",
  label: "Sonnet 5.5",
  allowServerFallback: true,
};
const customAnthropic: ResolvedSource = {
  kind: "custom",
  apiFormat: "anthropic",
  model: "claude-x",
  apiKey: "k-custom",
  baseURL: "https://proxy.example/anthropic",
  label: "mine",
  allowServerFallback: false,
};
const customOpenai: ResolvedSource = {
  kind: "custom",
  apiFormat: "openai",
  model: "gpt-x",
  apiKey: "k-openai",
  baseURL: "https://api.example/v1",
  label: "oa",
  allowServerFallback: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AI_MOCK;
});

describe("toOpenAiContent", () => {
  it("converts image and text blocks", () => {
    const parts = toOpenAiContent(content);
    expect(parts[0]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } });
    expect(parts[1]).toEqual({ type: "text", text: "hi" });
  });
});

describe("runStructured: anthropic format", () => {
  const ok = { parsed_output: { n: 1 }, usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: "end_turn" };

  it("builtin sonnet includes server-side fallback and returns usage", async () => {
    h.anthropicParse.mockResolvedValue(ok);
    const r = await runStructured({ ...base, source: builtin });
    expect(r).toEqual({ parsed: { n: 1 }, usage: { inputTokens: 10, outputTokens: 5 } });
    const call = h.anthropicParse.mock.calls[0][0];
    expect(call.betas).toContain("server-side-fallback-2026-07-01");
    expect(call.model).toBe("claude-sonnet-5-5");
    expect(h.anthropicCtor).toHaveBeenCalledWith({ apiKey: "k-builtin" });
  });

  it("custom omits betas and passes baseURL", async () => {
    h.anthropicParse.mockResolvedValue(ok);
    await runStructured({ ...base, source: customAnthropic });
    expect(h.anthropicParse.mock.calls[0][0].betas).toBeUndefined();
    expect(h.anthropicParse.mock.calls[0][0].fallbacks).toBeUndefined();
    expect(h.anthropicCtor).toHaveBeenCalledWith({ apiKey: "k-custom", baseURL: "https://proxy.example/anthropic" });
  });

  it("refusal maps to refused", async () => {
    h.anthropicParse.mockResolvedValue({ ...ok, stop_reason: "refusal" });
    await expect(runStructured({ ...base, source: builtin })).rejects.toMatchObject({ code: "refused" });
  });

  it("APIError maps to upstream", async () => {
    h.anthropicParse.mockRejectedValue(new h.AnthropicAPIError("boom"));
    await expect(runStructured({ ...base, source: builtin })).rejects.toMatchObject({ code: "upstream" });
  });

  it("retries once then invalid_output", async () => {
    h.anthropicParse.mockResolvedValue({ ...ok, parsed_output: null });
    await expect(runStructured({ ...base, source: builtin })).rejects.toBeInstanceOf(AiError);
    expect(h.anthropicParse).toHaveBeenCalledTimes(2);
  });
});

describe("runStructured: openai format", () => {
  const ok = {
    choices: [{ finish_reason: "stop", message: { parsed: { n: 2 }, refusal: null } }],
    usage: { prompt_tokens: 7, completion_tokens: 3 },
  };

  it("uses baseURL+apiKey, image_url content, maps usage", async () => {
    h.openaiParse.mockResolvedValue(ok);
    const r = await runStructured({ ...base, source: customOpenai });
    expect(r).toEqual({ parsed: { n: 2 }, usage: { inputTokens: 7, outputTokens: 3 } });
    expect(h.openaiCtor).toHaveBeenCalledWith({ apiKey: "k-openai", baseURL: "https://api.example/v1" });
    const call = h.openaiParse.mock.calls[0][0];
    expect(call.model).toBe("gpt-x");
    expect(call.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(call.messages[1].content[0]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } });
    expect(call.response_format).toBeDefined();
  });

  it("refusal field maps to refused", async () => {
    h.openaiParse.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { parsed: null, refusal: "no" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    await expect(runStructured({ ...base, source: customOpenai })).rejects.toMatchObject({ code: "refused" });
  });

  it("content_filter maps to refused", async () => {
    h.openaiParse.mockResolvedValue({
      choices: [{ finish_reason: "content_filter", message: { parsed: null, refusal: null } }],
    });
    await expect(runStructured({ ...base, source: customOpenai })).rejects.toMatchObject({ code: "refused" });
  });

  it("APIError maps to upstream", async () => {
    h.openaiParse.mockRejectedValue(new h.OpenAIAPIError("boom"));
    await expect(runStructured({ ...base, source: customOpenai })).rejects.toMatchObject({ code: "upstream" });
  });

  it("unparseable output retries once then invalid_output", async () => {
    h.openaiParse.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { parsed: null, refusal: null } }],
    });
    await expect(runStructured({ ...base, source: customOpenai })).rejects.toMatchObject({ code: "invalid_output" });
    expect(h.openaiParse).toHaveBeenCalledTimes(2);
  });
});

describe("AI_MOCK", () => {
  it("returns mock with zero usage", async () => {
    process.env.AI_MOCK = "1";
    const r = await runStructured({ ...base, source: builtin });
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(r.parsed).toBeDefined();
    expect(h.anthropicParse).not.toHaveBeenCalled();
  });
});
