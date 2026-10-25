import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({ runStructured: vi.fn() }));

import { createServerSupabase } from "@/lib/supabase/server";
import { runStructured } from "@/lib/ai/run";
import { POST as statement } from "@/app/api/ai/statement/route";
import { POST as receipt } from "@/app/api/ai/receipt/route";
import { POST as categorize } from "@/app/api/ai/categorize/route";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fakeSupabase(opts: { user?: { id: string } | null; defaultModel?: string; rpcError?: string } = {}) {
  const user = opts.user === undefined ? { id: USER } : opts.user;
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { default_model: opts.defaultModel ?? "sonnet" }, error: null }) }),
      }),
    }),
    rpc: vi.fn(async () => ({ data: null, error: opts.rpcError ? { message: opts.rpcError } : null })),
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), error: null }),
      }),
    },
  };
}

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

  it("uses the profile's default model and returns mapped transactions", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase({ defaultModel: "opus" }) as never);
    vi.mocked(runStructured).mockResolvedValue(statementResult);
    const res = await statement(post({ imagePath: `${USER}/statement/x.jpg` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe("opus");
    expect(body.transactions[0]).toMatchObject({ amountPence: 2345, status: "pending", merchant: "Tesco" });
    expect(vi.mocked(runStructured).mock.calls[0][0].model).toBe("opus");
  });

  it("lets the request override the model", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase() as never);
    vi.mocked(runStructured).mockResolvedValue(statementResult);
    await statement(post({ imagePath: `${USER}/statement/x.jpg`, model: "haiku" }));
    expect(vi.mocked(runStructured).mock.calls[0][0].model).toBe("haiku");
  });
});

describe("/api/ai/receipt", () => {
  it("returns items and total in pence", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase() as never);
    vi.mocked(runStructured).mockResolvedValue({ merchant: "Tesco", items: [{ name: "Milk", price: 1.5 }], total: 1.5 });
    const res = await receipt(post({ imagePath: `${USER}/receipt/x.jpg` }));
    expect(await res.json()).toEqual({
      model: "sonnet", merchant: "Tesco", items: [{ name: "Milk", pricePence: 150 }], totalPence: 150,
    });
  });
});

describe("/api/ai/categorize", () => {
  it("returns one category per item", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase() as never);
    vi.mocked(runStructured).mockResolvedValue({ categories: ["groceries", "dining"] });
    const res = await categorize(post({ items: [{ merchant: "Tesco", amountPence: 100 }, { merchant: "Pret", amountPence: 500 }] }));
    expect(await res.json()).toEqual({ categories: ["groceries", "dining"] });
  });

  it("rejects a mismatched answer from the model", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase() as never);
    vi.mocked(runStructured).mockResolvedValue({ categories: ["groceries"] });
    const res = await categorize(post({ items: [{ merchant: "Tesco", amountPence: 100 }, { merchant: "Pret", amountPence: 500 }] }));
    expect(res.status).toBe(422);
  });

  it("rejects more than 200 items", async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(fakeSupabase() as never);
    const items = Array.from({ length: 201 }, () => ({ merchant: "x", amountPence: 1 }));
    expect((await categorize(post({ items }))).status).toBe(400);
  });
});
