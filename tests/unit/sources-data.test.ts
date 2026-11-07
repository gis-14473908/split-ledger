import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordingSupabase } from "./fake-supabase";
import { listSources, addSource, deleteSource, readQuota } from "../../src/lib/data/sources";
import { updateSettings } from "../../src/lib/data/settings";

const USER = "user-1";

function make(results: Record<string, unknown> = {}) {
  const base = recordingSupabase(results);
  const sb = { ...base, auth: { getUser: () => Promise.resolve({ data: { user: { id: USER } } }) } };
  return { sb: sb as unknown as SupabaseClient, calls: base.calls };
}

describe("sources data layer", () => {
  it("listSources never selects api_key", async () => {
    const { sb, calls } = make();
    await listSources(sb);
    const sel = calls.find((c) => c.op === "select")!;
    expect(String(sel.args[0])).not.toContain("api_key");
    expect(String(sel.args[0])).toContain("key_last4");
  });

  it("addSource stores the key and its last 4 chars", async () => {
    const { sb, calls } = make();
    await addSource(sb, USER, { label: " 我的Q ", provider: "qwen", model: "qwen3-vl-plus", apiKey: " sk-abcd1234 " });
    const ins = calls.find((c) => c.op === "insert")!;
    expect(ins.args[0]).toMatchObject({ owner_id: USER, label: "我的Q", key_last4: "1234", api_key: "sk-abcd1234" });
  });

  it("addSource throws on error", async () => {
    const { sb } = make({ ai_sources: { data: null, error: { message: "boom" } } });
    await expect(addSource(sb, USER, { label: "a", provider: "qwen", model: "m", apiKey: "k" })).rejects.toThrow("boom");
  });

  it("deleteSource deletes by id", async () => {
    const { sb, calls } = make();
    await deleteSource(sb, "s1");
    expect(calls.some((c) => c.op === "delete")).toBe(true);
    expect(calls.find((c) => c.op === "eq")!.args).toEqual(["id", "s1"]);
  });

  it("readQuota returns zeros when no row", async () => {
    const { sb } = make({ "ai_quota.single": { data: null, error: null } });
    expect(await readQuota(sb)).toEqual({ usedMicro: 0, grantedMicro: 0 });
  });

  it("readQuota maps the row", async () => {
    const { sb } = make({ "ai_quota.single": { data: { used_micro: 5, granted_micro: 7 }, error: null } });
    expect(await readQuota(sb)).toEqual({ usedMicro: 5, grantedMicro: 7 });
  });

  it("updateSettings writes default_source", async () => {
    const { sb, calls } = make();
    await updateSettings(sb, USER, { defaultSource: "custom:x" });
    const upd = calls.find((c) => c.op === "update")!;
    expect(upd.args[0]).toMatchObject({ default_source: "custom:x" });
  });
});
