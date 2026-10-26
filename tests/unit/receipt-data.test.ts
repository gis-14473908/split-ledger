import { expect, it } from "vitest";
import { saveReceipt } from "@/lib/data/receipt";
import { recordingSupabase } from "./fake-supabase";

const lines = [
  { id: "l1", pricePence: 145, includesMe: true, contactIds: [] },
  { id: "l2", pricePence: 550, includesMe: false, contactIds: ["c1"] },
  { id: "l3", pricePence: 200, includesMe: true, contactIds: ["c1"] },
];
const names = { l1: "Milk", l2: "Beer", l3: "Bread" };

it("replaces any earlier receipt, then stores the receipt and its items", async () => {
  const sb = recordingSupabase({ "receipts.single": { data: { id: "r1" }, error: null } });
  await saveReceipt(sb as never, "tx1", { imagePath: "u/receipt/a.jpg", totalPence: 895, model: "sonnet", lines, names });

  const ops = sb.calls.filter((c) => ["delete", "insert"].includes(c.op)).map((c) => `${c.op}:${c.table}`);
  expect(ops).toEqual(["delete:receipts", "insert:receipts", "insert:receipt_items"]);

  const del = sb.calls.findIndex((c) => c.op === "delete");
  expect(sb.calls[del + 1]).toMatchObject({ table: "receipts", op: "eq", args: ["transaction_id", "tx1"] });

  const receipt = sb.calls.find((c) => c.op === "insert" && c.table === "receipts")!.args[0];
  expect(receipt).toEqual({ transaction_id: "tx1", image_path: "u/receipt/a.jpg", total_pence: 895, model_used: "sonnet" });

  const items = sb.calls.find((c) => c.op === "insert" && c.table === "receipt_items")!.args[0];
  expect(items).toEqual([
    { receipt_id: "r1", name: "Milk", price_pence: 145, includes_me: true, contact_ids: [], position: 0 },
    { receipt_id: "r1", name: "Beer", price_pence: 550, includes_me: false, contact_ids: ["c1"], position: 1 },
    { receipt_id: "r1", name: "Bread", price_pence: 200, includes_me: true, contact_ids: ["c1"], position: 2 },
  ]);
});
