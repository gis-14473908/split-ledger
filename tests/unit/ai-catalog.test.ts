import { describe, expect, it } from "vitest";
import { DEFAULT_SOURCE_KEY, PRICES, PROVIDERS, builtinSourceKey, parseSourceKey, providerById } from "@/lib/ai/catalog";

describe("parseSourceKey", () => {
  it("parses builtin and custom keys", () => {
    expect(parseSourceKey("builtin:opus")).toEqual({ kind: "builtin", model: "opus" });
    expect(parseSourceKey("custom:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toEqual({ kind: "custom", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  });
  it("rejects bad input", () => {
    expect(parseSourceKey("builtin:gpt")).toBeNull();
    expect(parseSourceKey("custom:")).toBeNull();
    expect(parseSourceKey("")).toBeNull();
    expect(parseSourceKey(42)).toBeNull();
  });
  it("round-trips the builtin helper and default", () => {
    expect(parseSourceKey(builtinSourceKey("haiku"))).toEqual({ kind: "builtin", model: "haiku" });
    expect(DEFAULT_SOURCE_KEY).toBe("builtin:sonnet");
  });
});

describe("catalog", () => {
  it("has the expected shape", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["anthropic", "openai", "gemini", "qwen", "zhipu", "moonshot", "doubao"]);
    expect(providerById("qwen")?.apiFormat).toBe("openai");
    expect(providerById("anthropic")?.baseURL).toBeNull();
    expect(providerById("nope")).toBeUndefined();
    expect(Object.keys(PRICES)).toEqual(["haiku", "sonnet", "opus"]);
    expect(PRICES.sonnet.outMicroPerTok).toBeGreaterThan(0);
  });
});
