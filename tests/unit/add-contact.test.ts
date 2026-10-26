import { expect, it } from "vitest";
import { addContact } from "@/lib/data/contacts";
import { recordingSupabase } from "./fake-supabase";

const created = { data: { id: "c9", owner_id: "me", name: "孙豪", linked_user_id: null, invite_token: null, created_at: "" }, error: null };

it("creates a contact and records 'they owe me' as an opening balance", async () => {
  const sb = recordingSupabase({ "contacts.single": created });
  const c = await addContact(sb as never, " 孙豪 ", { direction: "theyOwe", pence: 3000 });
  expect(c.id).toBe("c9");
  const inserts = sb.calls.filter((x) => x.op === "insert");
  expect(inserts.map((x) => x.table)).toEqual(["contacts", "settlements"]);
  expect(inserts[0].args[0]).toEqual({ name: "孙豪" });
  expect(inserts[1].args[0]).toEqual({ contact_id: "c9", amount_pence: -3000, kind: "opening" });
});

it("records 'I owe them' with the opposite sign", async () => {
  const sb = recordingSupabase({ "contacts.single": created });
  await addContact(sb as never, "孙豪", { direction: "iOwe", pence: 1000 });
  expect(sb.calls.filter((x) => x.op === "insert")[1].args[0]).toMatchObject({ amount_pence: 1000, kind: "opening" });
});

it("skips the opening balance when it is zero", async () => {
  const sb = recordingSupabase({ "contacts.single": created });
  await addContact(sb as never, "孙豪", { direction: "theyOwe", pence: 0 });
  expect(sb.calls.filter((x) => x.op === "insert").map((x) => x.table)).toEqual(["contacts"]);
});
