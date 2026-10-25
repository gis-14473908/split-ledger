// Row shapes as returned by Supabase. Kept in step with supabase/migrations by hand.
import type { Bank } from "../banks";
import type { Category } from "../categories";

export type ModelKey = "haiku" | "sonnet" | "opus";

export type TxStatus = "pending" | "personal" | "shared" | "transfer" | "later";

export type Profile = {
  id: string;
  display_name: string;
  default_model: ModelKey;
  created_at: string;
};

export type Contact = {
  id: string;
  owner_id: string;
  name: string;
  linked_user_id: string | null;
  invite_token: string | null;
  created_at: string;
};

export type Transaction = {
  id: string;
  owner_id: string;
  import_id: string | null;
  occurred_on: string;
  occurred_at_time: string | null;
  merchant_raw: string;
  merchant: string;
  location: string | null;
  amount_pence: number;
  original_amount: number | null;
  original_currency: string | null;
  category: Category;
  bank: Bank;
  source: "screenshot" | "csv" | "manual";
  status: TxStatus;
  ai_hint: string | null;
  dedupe_key: string;
  created_at: string;
};

export type SplitRow = {
  id: string;
  transaction_id: string;
  contact_id: string | null;
  share_pence: number;
};

export type Settlement = {
  id: string;
  owner_id: string;
  contact_id: string;
  amount_pence: number;
  settled_on: string;
  note: string | null;
  created_at: string;
};

export type OwedShare = {
  owner_id: string;
  owner_name: string;
  transaction_id: string;
  occurred_on: string;
  merchant: string;
  amount_pence: number;
  share_pence: number;
};
