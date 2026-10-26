# 分账本 (split-ledger)

A phone-first web app for students in the UK: import bank transactions from screenshots, let Claude categorise them, swipe through each one to mark it as yours or shared, split shared ones evenly or item by item from a receipt photo, and see what each friend owes you.

- Next.js (App Router) on Vercel
- Supabase for auth, Postgres (row level security) and private image storage
- Claude (Anthropic API) for reading screenshots and receipts

Design: `docs/superpowers/specs/2026-10-25-split-ledger-design.md`. Plan: `docs/superpowers/plans/2026-10-25-split-ledger.md`.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev
```

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable (anon) key |
| `ANTHROPIC_API_KEY` | console.anthropic.com. Server only; never expose it to the browser |
| `AI_MOCK` | `1` returns fixed AI answers, for development and e2e tests without API cost |

## Tests

```bash
npm test          # unit tests (money, splits, balances, dedupe, AI routes, data layer)
npm run test:db   # SQL tests: spins up a throwaway local Postgres 16, applies migrations, checks RLS and functions
npm run e2e       # end-to-end smoke test, see e2e/smoke.spec.ts for prerequisites
```

## Database

Migrations live in `supabase/migrations` and are applied in order (0001 → 0006). `0003_storage.sql` needs Supabase's storage schema, so the local SQL tests skip it.

## Adding a bank's CSV format

Supported: **HSBC UK** (Online Banking → account → Search and filter → Download → CSV; no header row). To add another bank:

1. Export a CSV from the bank and redact names, card numbers and amounts you don't want to share.
2. Save it as `tests/fixtures/<bank>.csv` and write a test that parses it.
3. Implement a `CsvParser` in `src/lib/csv/<bank>.ts` (`detect` and `parse` receive raw rows of cells; return `ParsedTransaction`s with positive amounts for spending and `category: null` so the importer asks the AI to categorise).
4. Add it to `CSV_PARSERS` in `src/lib/csv/registry.ts`.
