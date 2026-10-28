"use client";

import { useState } from "react";
import { ReceiptAssigner } from "@/components/review/ReceiptAssigner";
import { SplitSheet } from "@/components/review/SplitSheet";
import type { ModelKey } from "@/lib/ai/models";
import { saveNewSplit, splitPeople, type Bill } from "@/lib/data/bills";
import { createContact } from "@/lib/data/review";
import type { Contact } from "@/lib/db/types";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type People = { includeMe: boolean; contactIds: string[] };

/**
 * Change who shares a bill and how, reusing the review flow. Saving replaces every share at
 * once, so one person's change always rebalances the others.
 */
export function EditSplit({
  bill,
  contacts: initialContacts,
  dropContactId,
  onCancel,
  onSaved,
}: {
  bill: Bill;
  contacts: Contact[];
  /** Start with this person already taken out (the "去掉" shortcut). */
  dropContactId?: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const sb = createBrowserSupabase();
  const [contacts, setContacts] = useState(initialContacts);
  const [receiptPeople, setReceiptPeople] = useState<People | null>(null);
  const now = splitPeople(bill);
  const target = { id: bill.id, merchant: bill.merchant, amountPence: bill.amount_pence };

  if (receiptPeople) {
    const r = bill.receipt;
    return (
      <ReceiptAssigner
        target={target}
        people={receiptPeople}
        contacts={contacts}
        existing={
          r
            ? {
                imagePath: r.image_path,
                model: (r.model_used ?? "sonnet") as ModelKey,
                lines: r.receipt_items.map((i) => ({
                  name: i.name,
                  pricePence: i.price_pence,
                  includesMe: i.includes_me,
                  contactIds: i.contact_ids,
                })),
              }
            : undefined
        }
        onCancel={onCancel}
        onDone={async (shares) => {
          await saveNewSplit(sb, bill.id, shares, true);
          onSaved();
        }}
      />
    );
  }

  return (
    <SplitSheet
      target={target}
      contacts={contacts}
      initial={{
        includeMe: now.includeMe,
        contactIds: now.contactIds.filter((id) => id !== dropContactId),
        mode: bill.receipt ? "receipt" : "even",
        hasReceipt: !!bill.receipt,
      }}
      onCreateContact={async (name) => {
        const c = await createContact(sb, name);
        setContacts((list) => [...list, c]);
        return c;
      }}
      onCancel={onCancel}
      onEqual={async (shares) => {
        await saveNewSplit(sb, bill.id, shares, false);
        onSaved();
      }}
      onReceipt={setReceiptPeople}
    />
  );
}
