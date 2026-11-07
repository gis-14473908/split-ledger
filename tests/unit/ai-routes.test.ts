import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({ runStructured: vi.fn() }));

import { createServerSupabase } from "@/lib/supabase/server";
import { runStructured } from "@/lib/ai/run";
import { POST as statement } from "@/app/api/ai/statement/route";
import { POST as receipt } from "@/app/api/ai/receipt/route";
import { POST as categorize } from "@/app/api/ai/categorize/route";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const CUSTOM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function fakeSupabase(
  opts: {
    user?: { id: string } | null;
    defaultSource?: string;
    rpcError?: string;
    quotaError?: string;
    aiSource?: { data: unknown; error: unknown };
  } = {},
) {
  const user = opts.user === undefined ? { id: USER } : opts.user;
  const rpcCalls: { fn: string; args?: Record<string, unknown> }[] = [];
  const aiSource = opts.aiSource ?? {
    data: { id: CUSTOM_ID, owner_id: USER, label: "My GPT", provider: "openai", model: "gpt-5", api_key: "sk-x" },
    error: null,
  };
  return {
    rpcCalls,
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === "ai_sources"
            ? { eq: () => ({ single: async () => aiSource }) }
            : { single: async () => ({ data: { default_source: opts.defaultSource ?? "builtin:sonnet" }, error: null }) },
      }),
    }),
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "ai_rate_check" && opts.rpcError) return { data: null, error: { message: opts.rpcError } };
      if (fn === "ai_quota_check" && opts.quotaError) return { data: null, error: { message: opts.quotaError } };
      return { data: null, error: null };
    }),
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), error: null }),
      }),
    },
  };
}

const usage = { inputTokens: 100, outputTokens: 50 };
const run = <T,>(parsed: T) => ({ parsed, usage });

const post = (body: unknown) =>
  new Request("http://localhost/api/ai", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const statementResult = {
  bank: "monzo",
  transactions: [
    {
      date: "2026-10-22", time: null, merchant_raw: "TESCO", merchant: "Tesco", location: null, amount: 23.45,
      original_amount: null, original_currency: null, category: "groceries", is_transfer: false, hint: null,
    },
  ],
};

beforeEach(() => {
  vi.mocked(runStructured).mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("AI_MOCK", "");
});

describe("/api/ai/statement", () => {
  it("rejects signed-out callers", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase({ user: null }) as never);
    expect((await statement(post({ imagePath: `${USER}/statement/x.jpg` }))).status).toBe(401);
  });

  it("rejects image paths outside the caller's folder", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase() as never);
    expect((await statement(post({ imagePath: "someone-else/statement/x.jpg" }))).status).toBe(400);
  });

  it("returns 429 with a Chinese message when rate limited", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase({ rpcError: "rate_limited" }) as never);
    const res = await statement(post({ imagePath: `${USER}/statement/x.jpg` }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "操作太频繁，请一分钟后再试" });
  });

  it("reports a missing API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase() as never);
    const res = await statement(post({ imagePath: `${USER}/statement/x.jpg` }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "还没有配置 AI 密钥" });
  });

  it("uses the profile's default source and returns mapped transactions", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase({ defaultSource: "builtin:opus" }) as never);
    vi.mocked(runStructured).mockResolvedValue(run(statementResult));
    const res = await statement(post({ imagePath: `${USER}/statement/x.jpg` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("Opus 5.5");
    expect(body.transactions[0]).toMatchObject({ amountPence: 2345, status: "pending", merchant: "Tesco" });
    expect(vi.mocked(runStructured).mock.calls[0][0].source.label).toBe("Opus 5.5");
  });

  it("lets the request override the source", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase() as never);
    vi.mocked(runStructured).mockResolvedValue(run(statementResult));
    await statement(post({ imagePath: `${USER}/statement/x.jpg`, source: "builtin:haiku" }));
    expect(vi.mocked(runStructured).mock.calls[0][0].source.label).toBe("Haiku 5.5");
  });
});

describe("/api/ai/receipt", () => {
  it("returns items and total in pence", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase() as never);
    vi.mocked(runStructured).mockResolvedValue(run({ merchant: "Tesco", items: [{ name: "Milk", price: 1.5 }], total: 1.5 }));
    const res = await receipt(post({ imagePath: `${USER}/receipt/x.jpg` }));
    expect(await res.json()).toEqual({
      source: "Sonnet 5.5", merchant: "Tesco", items: [{ name: "Milk", pricePence: 150 }], totalPence: 150,
    });
  });
});

describe("/api/ai/categorize", () => {
  it("returns one category per item", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase() as never);
    vi.mocked(runStructured).mockResolvedValue(run({ categories: ["groceries", "dining"] }));
    const res = await categorize(post({ items: [{ merchant: "Tesco", amountPence: 100 }, { merchant: "Pret", amountPence: 500 }] }));
    expect(await res.json()).toEqual({ categories: ["groceries", "dining"] });
  });

  it("rejects a mismatched answer from the model", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase() as never);
    vi.mocked(runStructured).mockResolvedValue(run({ categories: ["groceries"] }));
    const res = await categorize(post({ items: [{ merchant: "Tesco", amountPence: 100 }, { merchant: "Pret", amountPence: 500 }] }));
    expect(res.status).toBe(422);
  });

  it("rejects more than 200 items", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase() as never);
    const items = Array.from({ length: 201 }, () => ({ merchant: "x", amountPence: 1 }));
    expect((await categorize(post({ items }))).status).toBe(400);
  });
});

describe("source resolution and quota", () => {
  const body = { imagePath: `${USER}/statement/x.jpg` };

  it("blocks a built-in source when the free quota is used up", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase({ quotaError: "quota_exceeded" }) as never);
    const res = await statement(post(body));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "识别额度已用完，可在设置里添加你自己的 AI 源" });
    expect(vi.mocked(runStructured)).not.toHaveBeenCalled();
  });

  it("adds the cost to the quota after a built-in run", async () => {
    const sb = fakeSupabase();
    vi.mocked(createServerSupabase).mockResolvedValue(sb as never);
    vi.mocked(runStructured).mockResolvedValue(run(statementResult));
    const res = await statement(post({ ...body, source: "builtin:opus" }));
    expect((await res.json()).source).toBe("Opus 5.5");
    const names = sb.rpcCalls.map((c) => c.fn);
    expect(names.indexOf("ai_quota_check")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("ai_quota_add")).toBeGreaterThan(names.indexOf("ai_quota_check"));
    const add = sb.rpcCalls.find((c) => c.fn === "ai_quota_add");
    expect(add?.args?.p_micro as number).toBeGreaterThan(0);
  });

  it("uses a custom source without touching the quota", async () => {
    const sb = fakeSupabase();
    vi.mocked(createServerSupabase).mockResolvedValue(sb as never);
    vi.mocked(runStructured).mockResolvedValue(run(statementResult));
    const res = await statement(post({ ...body, source: `custom:${CUSTOM_ID}` }));
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe("My GPT");
    const src = vi.mocked(runStructured).mock.calls[0][0].source;
    expect(src).toMatchObject({ kind: "custom", apiFormat: "openai", model: "gpt-5", allowServerFallback: false });
    const names = sb.rpcCalls.map((c) => c.fn);
    expect(names).toContain("ai_rate_check");
    expect(names).not.toContain("ai_quota_check");
    expect(names).not.toContain("ai_quota_add");
  });

  it("rejects a forged custom source id", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(
      fakeSupabase({ aiSource: { data: null, error: { message: "no rows" } } }) as never,
    );
    const res = await statement(post({ ...body, source: `custom:${CUSTOM_ID}` }));
    expect(res.status).toBe(400);
  });
});
