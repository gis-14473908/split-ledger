import { expect, it } from "vitest";
import { existingDedupeKeys, saveImport, uploadImage } from "@/lib/data/import";
import { dedupeKey } from "@/lib/dedupe";
import { recordingSupabase } from "./fake-supabase";
import { tx } from "./fixtures";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

it("uploads into the user's own folder as jpeg", async () => {
  const sb = recordingSupabase();
  const path = await uploadImage(sb as never, USER, new Blob(["x"]), "statement");
  expect(path.startsWith(`${USER}/statement/`)).toBe(true);
  expect(path.endsWith(".jpg")).toBe(true);
  expect(sb.uploads).toEqual([{ bucket: "uploads", path }]);
});

it("writes the import first, then its transactions with dedupe keys", async () => {
  const sb = recordingSupabase({ "imports.single": { data: { id: "imp-1" }, error: null } });
  const rows = [
    { ...tx(), status: "pending" as const },
    { ...tx({ amountPence: -500, merchantRaw: "REFUND" }), status: "transfer" as const },
  ];
  const n = await saveImport(sb as never, rows, { kind: "screenshot", filePaths: ["p1"], model: "sonnet" });
  expect(n).toBe(2);
  const inserts = sb.calls.filter((c) => c.op === "insert");
  expect(inserts.map((c) => c.table)).toEqual(["imports", "transactions"]);
  const txRows = inserts[1].args[0] as Record<string, unknown>[];
  expect(txRows[0]).toMatchObject({
    import_id: "imp-1",
    dedupe_key: dedupeKey(rows[0]),
    amount_pence: 2345,
    merchant_raw: "TESCO 3021",
    status: "pending",
    source: "screenshot",
    bank: "monzo",
  });
  expect(txRows[1]).toMatchObject({ status: "transfer" });
});

it("looks up which dedupe keys already exist", async () => {
  const sb = recordingSupabase({ transactions: { data: [{ dedupe_key: "k1" }], error: null } });
  expect(await existingDedupeKeys(sb as never, ["k1", "k2"])).toEqual(new Set(["k1"]));
});
