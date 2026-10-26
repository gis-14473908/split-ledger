import { expect, it } from "vitest";
import { saveLater, savePersonal } from "@/lib/data/review";
import { recordingSupabase } from "./fake-supabase";

it("marks personal and later through the guarded database function", async () => {
  const sb = recordingSupabase();
  await savePersonal(sb as never, "t1");
  await saveLater(sb as never, "t2");
  expect(sb.rpcCalls).toEqual([
    { fn: "set_transaction_status", args: { p_tx: "t1", p_status: "personal" } },
    { fn: "set_transaction_status", args: { p_tx: "t2", p_status: "later" } },
  ]);
});

it("reports a card another device already decided", async () => {
  const sb = recordingSupabase({ "rpc.set_transaction_status": { data: null, error: { message: "stale" } } });
  await expect(savePersonal(sb as never, "t1")).rejects.toThrow("这笔已经在别处处理过了，刷新一下");
});
