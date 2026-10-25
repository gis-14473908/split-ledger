# split-ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手机网页记账应用：截图导入银行交易 → AI 分类 → 叠卡逐笔确认 → 平均分 / 按小票分账 → 面板显示每个人的净欠款，多用户、可邀请同学关联。

**Architecture:** Next.js App Router 应用部署在 Vercel；Supabase 提供 Auth、Postgres（RLS 隔离 + `security definer` 函数做跨用户读取和原子写入）和私有 Storage。金额、分账、欠款等计算都是 `src/lib` 里的纯 TypeScript 函数，用单元测试保证正确；AI 识别在 Route Handler 里调用 Claude，用结构化输出加 Zod 校验。

**Tech Stack:** Node 22，next 16.4.0，react 19.3.0，TypeScript，tailwindcss 4.3.3，@supabase/supabase-js 2.117.3，@supabase/ssr 0.12.7，@anthropic-ai/sdk 0.133.0，zod 4.6.6，papaparse 5.7.0，vitest 5.0.3，@playwright/test 1.64.0。（版本都选发布满两周的；安装时用 `--save-exact`。）

**Spec:** `docs/superpowers/specs/2026-10-25-split-ledger-design.md`

## Global Constraints

- 界面文案全部中文；币种显示一律 `£12.34`（负数 `-£1.20`）。
- 金额在代码和数据库里一律是**整数便士**（`*_pence`，`integer`），只在显示和 AI 边界转换。
- 分类固定 9 个，键和中文名：`groceries` 超市、`dining` 餐饮外卖、`transport` 交通、`shopping` 购物、`bills` 房租水电、`entertainment` 娱乐、`health` 医疗、`transfer` 转账、`other` 其他。
- 银行键：`hsbc` / `monzo` / `lloyds` / `cmb`（招商银行）/ `other`。
- 模型键与 ID：`haiku` → `claude-haiku-5-5`，`sonnet` → `claude-sonnet-5-5`（默认），`opus` → `claude-opus-5-5`。
- `ANTHROPIC_API_KEY` 只能在服务器端代码读取；任何 `"use client"` 文件都不能 import `src/lib/ai/*`。
- 所有表开启 RLS；用户只能读写 `owner_id = auth.uid()` 的行，跨用户读取只通过本计划定义的 `security definer` 函数。
- 平均分除不尽时，余数全给“我”；“我”不在分账人里时给参与者列表的第一个人。同一笔交易的份额之和必须等于交易金额。
- AI 接口每个用户每分钟最多 10 次调用，超出返回 HTTP 429 和文案“操作太频繁，请一分钟后再试”。
- 移动端优先：设计宽度 390px，桌面上居中显示，最大宽度 480px。

## Review Focus

1. **同一张截图导入两次**：第二次预览里的每一行都应标“可能重复”并默认不勾选，包括和数据库里已有交易重复的情况。→ Task 4 `markDuplicates` 测试覆盖库内和批内重复。
2. **退款和收入**：截图里出现正数入账（退款、工资、朋友转账），不应进入分账队列。→ Task 6 `toParsedTransactions` 测试：负金额或 `is_transfer` 映射为 `status: "transfer"`。
3. **自己打开自己的邀请链接，或链接被用两次**：应提示失败，不能把联系人关联到自己。→ Task 5 SQL 测试 `accept_invite` 拒绝 owner 本人和已使用的 token。
4. **iPhone 的 HEIC 照片**：非 Safari 浏览器无法解码时，应给出明确提示，不能无响应。→ Task 7 `compressImage` 在解码失败时抛出 `ImageDecodeError`，并有对应文案测试。
5. **撤销一笔已分账的交易**：份额和小票必须一起删掉，否则面板金额会出错。→ Task 5 SQL 测试 `reset_transaction` 清空 splits 和 receipts。

---

## 文件结构

```
split-ledger/
  package.json  tsconfig.json  next.config.ts  postcss.config.mjs  vitest.config.ts  playwright.config.ts  .env.example
  supabase/
    migrations/0001_schema.sql      表、约束、RLS、触发器
    migrations/0002_functions.sql   security definer 函数
    migrations/0003_storage.sql     Storage 桶和策略（本地测试不跑）
    tests/auth_stub.sql             本地 Postgres 模拟 auth schema 和角色
    tests/db.test.sql               SQL 断言测试
  scripts/test-db.sh                起临时 Postgres → 跑 stub + 0001 + 0002 + tests
  src/
    lib/
      money.ts  categories.ts  banks.ts
      split/equal.ts  split/receipt.ts
      balance.ts  dedupe.ts  hints.ts  dates.ts
      import/types.ts               ParsedTransaction
      csv/registry.ts               CsvParser 接口 + 空注册表 + parseCsv
      ai/models.ts  ai/schemas.ts  ai/prompts.ts  ai/run.ts  ai/mock.ts  ai/route-helpers.ts
      image/compress.ts
      review/queue.ts               滑卡队列纯状态机
      supabase/browser.ts  supabase/server.ts  supabase/middleware.ts
      data/*.ts                     各页面的数据读写（薄封装）
    app/
      layout.tsx  globals.css  manifest.ts  page.tsx（面板）
      login/page.tsx  signup/page.tsx
      import/page.tsx  review/page.tsx  contacts/[id]/page.tsx  invite/[token]/page.tsx  settings/page.tsx
      api/ai/statement/route.ts  api/ai/receipt/route.ts  api/ai/categorize/route.ts
    components/
      BottomNav.tsx
      import/PreviewList.tsx
      review/HandStrip.tsx  review/TxCard.tsx  review/SwipeDeck.tsx  review/SplitSheet.tsx  review/ReceiptAssigner.tsx
      dashboard/BalanceList.tsx  dashboard/MonthlySpend.tsx
    middleware.ts
  tests/unit/*.test.ts
  e2e/smoke.spec.ts  e2e/seed-users.sql
```

---

### Task 1: 脚手架、金额和分类

**Files:**
- Create: 项目骨架（`package.json`、`tsconfig.json`、`next.config.ts`、`postcss.config.mjs`、`vitest.config.ts`、`src/app/layout.tsx`、`src/app/globals.css`、`src/app/page.tsx` 占位、`.gitignore`、`.env.example`）
- Create: `src/lib/money.ts`、`src/lib/categories.ts`、`src/lib/banks.ts`
- Test: `tests/unit/money.test.ts`、`tests/unit/categories.test.ts`

**Interfaces:**
- Produces:
  - `formatPence(pence: number): string`
  - `parsePounds(input: string): number | null`：返回便士
  - `poundsToPence(x: number): number`：`Math.round(x * 100)`，消除浮点误差
  - `CATEGORIES`（`as const` 元组）、`type Category`、`CATEGORY_LABEL: Record<Category, string>`、`CATEGORY_COLOR: Record<Category, string>`
  - `BANKS`、`type Bank`、`BANK_LABEL: Record<Bank, string>`（`cmb` → `招商银行`）

- [ ] **Step 1:** 在仓库根目录初始化 Next.js（TypeScript、App Router、`src/` 目录、Tailwind 4、无 ESLint 以外的模板），按 Tech Stack 精确锁版本，加入 vitest。`package.json` scripts：`dev`、`build`、`start`、`test`（`vitest run`）、`typecheck`（`tsc --noEmit`）、`test:db`（`bash scripts/test-db.sh`）、`e2e`（`playwright test`）。`.env.example` 列出 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`ANTHROPIC_API_KEY`、`AI_MOCK`。
- [ ] **Step 2: 写失败的测试**

```ts
// tests/unit/money.test.ts
expect(formatPence(1234)).toBe("£12.34");
expect(formatPence(5)).toBe("£0.05");
expect(formatPence(-120)).toBe("-£1.20");
expect(formatPence(123456)).toBe("£1,234.56");
expect(parsePounds("12.3")).toBe(1230);
expect(parsePounds("£1,234.50")).toBe(123450);
expect(parsePounds("abc")).toBeNull();
expect(parsePounds("")).toBeNull();
expect(poundsToPence(0.1 + 0.2)).toBe(30);
// tests/unit/categories.test.ts
expect(CATEGORIES).toHaveLength(9);
expect(CATEGORY_LABEL.groceries).toBe("超市");
expect(CATEGORY_LABEL.transfer).toBe("转账");
expect(BANK_LABEL.cmb).toBe("招商银行");
```

- [ ] **Step 3:** 运行 `npm test`，预期 FAIL（模块不存在）。
- [ ] **Step 4:** 实现三个模块。
- [ ] **Step 5:** 运行 `npm test && npm run typecheck && npm run build`，预期全部通过。
- [ ] **Step 6:** 提交 `chore: scaffold Next.js app with money and category helpers`。

---

### Task 2: 分账计算（平均分、按小票分）

**Files:**
- Create: `src/lib/split/equal.ts`、`src/lib/split/receipt.ts`
- Test: `tests/unit/split.test.ts`

**Interfaces:**
- Produces:
  - `type Share = { contactId: string | null; sharePence: number }`（`null` 表示我）
  - `equalSplit(totalPence: number, participants: (string | null)[]): Share[]`：参与者为空或重复时抛 `Error`；按传入顺序输出
  - `type ReceiptLine = { id: string; pricePence: number; includesMe: boolean; contactIds: string[] }`
  - `unassignedLines(lines: ReceiptLine[]): string[]`：返回没有任何归属的行 id
  - `type Reconcile = "proportional" | "me"`
  - `receiptSplit(lines: ReceiptLine[], totalPence: number, reconcile: Reconcile): Share[]`：存在未归属的行时抛 `Error`；输出中“我”（如有）排第一，其余按首次出现顺序

- [ ] **Step 1: 写失败的测试**

```ts
expect(equalSplit(1000, [null, "a", "b"])).toEqual([
  { contactId: null, sharePence: 334 }, { contactId: "a", sharePence: 333 }, { contactId: "b", sharePence: 333 }]);
expect(equalSplit(1001, ["a", "b", null]).find(s => s.contactId === null)!.sharePence).toBe(335);
expect(equalSplit(1001, ["a", "b"])).toEqual([{ contactId: "a", sharePence: 501 }, { contactId: "b", sharePence: 500 }]); // 代付：余数给第一个
expect(() => equalSplit(100, [])).toThrow();
expect(() => equalSplit(100, ["a", "a"])).toThrow();

const lines = [
  { id: "milk", pricePence: 150, includesMe: true, contactIds: [] },
  { id: "beer", pricePence: 600, includesMe: false, contactIds: ["a"] },
  { id: "bread", pricePence: 100, includesMe: true, contactIds: ["a"] }, // 共享 → 50/50
];
expect(receiptSplit(lines, 850, "me")).toEqual([{ contactId: null, sharePence: 200 }, { contactId: "a", sharePence: 650 }]);
// 银行比小票多 85p（例如小费）：按小计比例 200:650 分摊
const p = receiptSplit(lines, 935, "proportional");
expect(p.reduce((s, x) => s + x.sharePence, 0)).toBe(935);
expect(p).toEqual([{ contactId: null, sharePence: 220 }, { contactId: "a", sharePence: 715 }]);
// 折扣：银行少 50p，算我头上
expect(receiptSplit(lines, 800, "me")[0].sharePence).toBe(150);
expect(unassignedLines([{ id: "x", pricePence: 1, includesMe: false, contactIds: [] }])).toEqual(["x"]);
expect(() => receiptSplit([{ id: "x", pricePence: 1, includesMe: false, contactIds: [] }], 1, "me")).toThrow();
```

- [ ] **Step 2:** 运行 `npx vitest run tests/unit/split.test.ts`，预期 FAIL。
- [ ] **Step 3:** 实现。每一行内部用 `equalSplit` 在其归属人之间平分（`includesMe` 时“我”在最前）；按比例分摊差额用最大余数法：先按 `diff * subtotal / sum` 向零取整，剩余的便士依次分给小数部分最大的人，保证总和精确。
- [ ] **Step 4:** 运行测试，预期 PASS。
- [ ] **Step 5:** 提交 `feat: equal and receipt-based split calculation`。

---

### Task 3: 欠款计算和提示文案

**Files:**
- Create: `src/lib/balance.ts`、`src/lib/hints.ts`、`src/lib/dates.ts`
- Test: `tests/unit/balance.test.ts`、`tests/unit/hints.test.ts`

**Interfaces:**
- Produces:
  - `type BalanceInput = { owedToMe: { contactId: string; sharePence: number }[]; owedByMe: { contactId: string; sharePence: number }[]; settlements: { contactId: string; amountPence: number }[] }`
  - `computeBalances(input: BalanceInput): Record<string, number>`：正数表示对方欠我；只包含出现过的联系人；结果为 0 的联系人也保留
  - `formatCnDate(isoDate: string): string`：`"2026-10-15"` → `"10月15日"`；`weekdayCn(isoDate: string): string`：`"2026-10-22"` → `"周四"`
  - `type PastDecision = { occurredOn: string; amountPence: number; status: "personal" | "shared"; contactNames: string[] }`
  - `historyHint(past: PastDecision | null, aiHint: string | null): string | null`

- [ ] **Step 1: 写失败的测试**

```ts
expect(computeBalances({
  owedToMe: [{ contactId: "a", sharePence: 1000 }, { contactId: "a", sharePence: 500 }, { contactId: "b", sharePence: 300 }],
  owedByMe: [{ contactId: "a", sharePence: 200 }],
  settlements: [{ contactId: "a", amountPence: 300 }, { contactId: "b", amountPence: -100 }],
})).toEqual({ a: 1000, b: 400 });
expect(formatCnDate("2026-10-15")).toBe("10月15日");
expect(weekdayCn("2026-10-22")).toBe("周四");
expect(historyHint({ occurredOn: "2026-10-15", amountPence: 1820, status: "shared", contactNames: ["孙豪"] }, null))
  .toBe("上次在这家：10月15日 £18.20，和孙豪分账");
expect(historyHint({ occurredOn: "2026-10-15", amountPence: 1820, status: "personal", contactNames: [] }, "x"))
  .toBe("上次在这家：10月15日 £18.20，自己的");
expect(historyHint(null, "可能是聚餐")).toBe("可能是聚餐");
expect(historyHint(null, null)).toBeNull();
```

多个联系人用顿号连接：`["孙豪","李明"]` → `和孙豪、李明分账`。

- [ ] **Step 2:** 运行测试，预期 FAIL。
- [ ] **Step 3:** 实现。日期按 UTC 解析 ISO 日期，避免时区导致星期错位。
- [ ] **Step 4:** 运行测试，预期 PASS。
- [ ] **Step 5:** 提交 `feat: balance computation and memory hints`。

---

### Task 4: 导入类型、去重、CSV 预留接口

**Files:**
- Create: `src/lib/import/types.ts`、`src/lib/dedupe.ts`、`src/lib/csv/registry.ts`
- Test: `tests/unit/dedupe.test.ts`、`tests/unit/csv.test.ts`

**Interfaces:**
- Consumes: `Category`、`Bank`（Task 1）
- Produces:
  - `type ParsedTransaction = { occurredOn: string; occurredTime: string | null; merchantRaw: string; merchant: string; location: string | null; amountPence: number; originalAmount: number | null; originalCurrency: string | null; category: Category | null; isTransfer: boolean; hint: string | null; bank: Bank }`，其中 `amountPence > 0` 为支出，`< 0` 为收入或退款
  - `normalizeMerchant(s: string): string`：转小写，去掉数字和标点（保留中日韩字符），合并空白
  - `dedupeKey(t: { occurredOn: string; amountPence: number; merchantRaw: string }): string`：`${occurredOn}|${amountPence}|${normalizeMerchant(merchantRaw)}`
  - `markDuplicates<T extends ParsedTransaction>(batch: T[], existingKeys: Set<string>): (T & { duplicate: boolean })[]`：库里已有的标重复；同一批次内后出现的标重复，第一次出现的不标
  - `interface CsvParser { bank: Bank; detect(headers: string[]): boolean; parse(rows: Record<string, string>[]): ParsedTransaction[] }`
  - `CSV_PARSERS: CsvParser[]`（本期为空数组）
  - `parseCsv(text: string, parsers?: CsvParser[]): { ok: true; bank: Bank; transactions: ParsedTransaction[] } | { ok: false; error: "empty" | "unsupported" }`
  - `CSV_UNSUPPORTED_MESSAGE = "暂不支持这个格式，请先用截图导入"`

- [ ] **Step 1: 写失败的测试**

```ts
expect(normalizeMerchant("TESCO STORES 3021, Manchester")).toBe("tesco stores manchester");
expect(normalizeMerchant("招商银行 消费")).toBe("招商银行 消费");
const t = (o: Partial<ParsedTransaction>): ParsedTransaction => ({ occurredOn: "2026-10-22", occurredTime: null, merchantRaw: "TESCO 3021", merchant: "Tesco", location: null, amountPence: 2345, originalAmount: null, originalCurrency: null, category: "groceries", isTransfer: false, hint: null, bank: "monzo", ...o });
const existing = new Set([dedupeKey(t({}))]);
expect(markDuplicates([t({}), t({ amountPence: 100 }), t({ amountPence: 100 })], existing).map(x => x.duplicate))
  .toEqual([true, false, true]);
expect(parseCsv("")).toEqual({ ok: false, error: "empty" });
expect(parseCsv("Date,Amount\n2026-10-01,1.00")).toEqual({ ok: false, error: "unsupported" });
const fake: CsvParser = { bank: "monzo", detect: h => h.includes("Emoji"), parse: rows => rows.map(r => t({ merchantRaw: r.Name })) };
const r = parseCsv("Name,Emoji\nPret,x", [fake]);
expect(r.ok && r.transactions[0].merchantRaw).toBe("Pret");
```

- [ ] **Step 2:** 运行测试，预期 FAIL。
- [ ] **Step 3:** 实现。`parseCsv` 用 papaparse（`header: true, skipEmptyLines: true`）。
- [ ] **Step 4:** 运行测试，预期 PASS。
- [ ] **Step 5:** 提交 `feat: import types, duplicate detection, CSV parser registry`。

---

### Task 5: 数据库迁移和 SQL 测试

**Files:**
- Create: `supabase/migrations/0001_schema.sql`、`0002_functions.sql`、`0003_storage.sql`
- Create: `supabase/tests/auth_stub.sql`、`supabase/tests/db.test.sql`、`scripts/test-db.sh`
- Create: `src/lib/db/types.ts`（表的行类型，手写，和 SQL 一一对应）

**Interfaces:**
- Produces（表）：按 spec §3，补充以下精确定义：
  - `profiles(id uuid pk references auth.users on delete cascade, display_name text not null, default_model text not null default 'sonnet' check in ('haiku','sonnet','opus'), created_at timestamptz default now())`；`auth.users` insert 触发器自动建 profile，`display_name` 取 `raw_user_meta_data->>'display_name'`，缺省用邮箱 @ 前面的部分。
  - `contacts`：增加 `unique (owner_id, linked_user_id)`、`unique (invite_token)`。
  - `transactions`：列按 spec §3，`status` check in `('pending','personal','shared','transfer','later')`，`category` check 在 9 个分类内，`bank` check 在 5 个银行键内；索引 `(owner_id, status)`、`(owner_id, occurred_on)`、`(owner_id, dedupe_key)`。
  - `receipts(id, transaction_id unique references transactions on delete cascade, image_path text, total_pence int, model_used text)`；`receipt_items(id, receipt_id references receipts on delete cascade, name text, price_pence int, includes_me bool, contact_ids uuid[])`。
  - `splits(id, transaction_id references transactions on delete cascade, contact_id uuid null references contacts on delete restrict, share_pence int not null)`。
  - `settlements`：按 spec §3。
  - `ai_usage(id bigserial, user_id uuid, kind text, model text, created_at timestamptz default now())`，索引 `(user_id, created_at)`。
- Produces（函数，全部 `security definer`、`set search_path = public`，开头检查 `auth.uid()` 非空）：
  - `set_transaction_split(p_tx uuid, p_shares jsonb) returns void`：`p_shares` 形如 `[{"contact_id": uuid|null, "share_pence": int}]`；校验交易属于调用者、每个 contact 属于调用者、份额之和 = `amount_pence`；删除旧 splits，插入新 splits，`status = 'shared'`。
  - `reset_transaction(p_tx uuid) returns void`：删除 splits 和 receipt，`status = 'pending'`。
  - `create_invite(p_contact uuid) returns text`：生成 24 字节随机 base64url token 写入并返回；联系人已关联时抛错。
  - `accept_invite(p_token text) returns uuid`：返回被关联的联系人 id。token 不存在或已使用 → `raise exception 'invite_invalid'`；联系人的 owner 是调用者本人 → `'invite_self'`；调用者已被该 owner 的另一个联系人关联 → `'invite_already_linked'`。成功后设置 `linked_user_id`、清空 token，并为调用者建一个指向 owner 的反向联系人（名字用 owner 的 `display_name`；已存在则跳过）。
  - `shares_owed_by_me() returns table(owner_id uuid, owner_name text, transaction_id uuid, occurred_on date, merchant text, amount_pence int, share_pence int)`：别人账本里分给“关联到我的联系人”的份额。
  - `monthly_spend(p_month date) returns table(category text, pence bigint, pending_count int)`：调用者当月（`p_month` 所在月份）的支出。`personal`、`pending`、`later` 计全额，`shared` 只计 `contact_id is null` 的份额，`transfer` 不计。`pending_count` 是当月 `pending` 和 `later` 的笔数（每行相同）。
  - `ai_rate_check(p_kind text, p_model text) returns void`：最近 60 秒内该用户的 `ai_usage` 已有 10 条 → `raise exception 'rate_limited'`；否则插入一条记录。
- Produces（Storage，`0003`）：私有桶 `uploads`；`storage.objects` 的 select/insert/delete 策略要求 `bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text`。

- [ ] **Step 1:** 写 `supabase/tests/auth_stub.sql`：建 `auth` schema、`auth.users(id uuid primary key, email text, raw_user_meta_data jsonb)`、`auth.uid()`（读取 `current_setting('request.jwt.claim.sub', true)`）、角色 `anon` 和 `authenticated`，并给 `authenticated` 授予 `public` schema 的使用权限。写 `scripts/test-db.sh`：用 `/usr/lib/postgresql/16/bin/initdb` 在临时目录建库、`pg_ctl` 启动到一个空闲端口、依次 `psql -v ON_ERROR_STOP=1` 执行 stub、0001、0002、`db.test.sql`，最后停库并删除目录（用 trap 保证清理）；以 root 运行时用 `su postgres` 或 `runuser` 执行。
- [ ] **Step 2: 写失败的 SQL 测试** `supabase/tests/db.test.sql`。插入用户 A、B、C 后，用 `set local role authenticated; set local request.jwt.claim.sub = '<uuid>'` 切换身份，用 `DO $$ ... assert ... $$` 断言：
  - B 查询 A 的 `transactions`、`contacts`、`splits`，返回 0 行
  - A 对 £10.00 交易调用 `set_transaction_split`，份额 334/333/333 成功，`status = 'shared'`；份额总和 999 时报错
  - A 用 B 的联系人 id 做份额 → 报错
  - `reset_transaction` 之后，该交易的 splits 和 receipts 均为 0 行，`status = 'pending'`
  - A 对自己的邀请调用 `accept_invite` → `invite_self`；B 接受成功；C 再用同一 token → `invite_invalid`；B 名下自动出现一个 `linked_user_id = A` 的联系人
  - B 调用 `shares_owed_by_me()` 只看到 A 账本里分给 B 的那一行
  - `monthly_spend`：个人 £5 加共享交易里我的 334p，`groceries` 合计 834；`transfer` 不计入
  - 连续调用 `ai_rate_check` 10 次成功，第 11 次报 `rate_limited`
- [ ] **Step 3:** 运行 `npm run test:db`，预期 FAIL（迁移文件不存在）。
- [ ] **Step 4:** 写三个迁移文件和 `src/lib/db/types.ts`。
- [ ] **Step 5:** 运行 `npm run test:db`，预期全部断言通过，退出码 0。
- [ ] **Step 6:** 提交 `feat: database schema, RLS and SQL functions with tests`。

---

### Task 6: AI 识别层和三个接口

**Files:**
- Create: `src/lib/ai/models.ts`、`schemas.ts`、`prompts.ts`、`run.ts`、`mock.ts`、`route-helpers.ts`
- Create: `src/lib/supabase/server.ts`（`createServerSupabase(): Promise<SupabaseClient>`，基于 `@supabase/ssr` 读写 cookies）
- Create: `src/app/api/ai/statement/route.ts`、`receipt/route.ts`、`categorize/route.ts`
- Test: `tests/unit/ai-schemas.test.ts`、`tests/unit/ai-routes.test.ts`

**Interfaces:**
- Consumes: `ParsedTransaction`（Task 4）、`poundsToPence`（Task 1）、`ai_rate_check`（Task 5）
- Produces:
  - `MODEL_IDS: Record<ModelKey, string>`、`type ModelKey = "haiku" | "sonnet" | "opus"`、`isModelKey(x: unknown): x is ModelKey`
  - Zod：`StatementResult`（`{ bank, transactions: [{ date "YYYY-MM-DD", time "HH:MM"|null, merchant_raw, merchant, location|null, amount (英镑数值，支出为正、收入为负), original_amount|null, original_currency|null, category, is_transfer, hint|null }] }`）、`ReceiptResult`（`{ merchant|null, items: [{ name, price }], total }`）、`CategorizeResult`（`{ categories: Category[] }`）
  - `toParsedTransactions(r: StatementResult): (ParsedTransaction & { status: "pending" | "transfer" })[]`：`amount < 0` 或 `is_transfer` → `status: "transfer"` 且 `category: "transfer"`
  - `runStructured<T>(o: { model: ModelKey; system: string; content: Anthropic.Messages.ContentBlockParam[]; schema: z.ZodType<T>; mockKey: "statement" | "receipt" | "categorize" }): Promise<T>`
  - `class AiError extends Error { code: "refused" | "invalid_output" | "rate_limited" | "unauthorized" | "bad_request" }`
  - 接口（都是 POST、JSON、要求登录）：
    - `/api/ai/statement` 入参 `{ imagePath: string; model?: ModelKey }` → `{ model: ModelKey; transactions: (ParsedTransaction & { status })[] }`
    - `/api/ai/receipt` 入参 `{ imagePath: string; model?: ModelKey }` → `{ model: ModelKey; merchant: string | null; items: { name: string; pricePence: number }[]; totalPence: number }`
    - `/api/ai/categorize` 入参 `{ items: { merchant: string; amountPence: number }[] }`（最多 200 条）→ `{ categories: Category[] }`，长度与入参一致
  - 错误响应统一为 `{ error: string }`（中文文案），状态码：未登录 401，参数错 400，`rate_limited` 429，`refused` 和 `invalid_output` 422

- [ ] **Step 1: 写失败的测试**
  - `ai-schemas.test.ts`：一个合法的 `StatementResult` 样例经 `toParsedTransactions` 后得到 `amountPence: 2345`；`amount: -50` 的那一行得到 `status: "transfer"`、`category: "transfer"`；含 `original_amount: 297.4, original_currency: "CNY"` 的行原样保留；`StatementResult.safeParse` 拒绝 `date: "22/10"`。
  - `ai-routes.test.ts`：用 `vi.mock` 替换 `createServerSupabase` 和 `runStructured`。未登录 → 401；`imagePath` 不以 `${userId}/` 开头 → 400；`ai_rate_check` 抛 `rate_limited` → 429，响应体为 `{ error: "操作太频繁，请一分钟后再试" }`；正常请求返回 200 和映射后的交易；`model` 缺省时使用 profile 的 `default_model`。
- [ ] **Step 2:** 运行测试，预期 FAIL。
- [ ] **Step 3:** 实现。要点：
  - `run.ts` 使用 `client.beta.messages.parse`，`output_config: { effort: "medium", format: zodOutputFormat(schema) }`，`max_tokens: 16000`；`sonnet` 和 `opus` 额外传 `betas: ["server-side-fallback-2026-07-01"]` 和 `fallbacks: "default"`。`stop_reason === "refusal"` → `AiError("refused")`；解析结果为空时重试一次，仍失败 → `AiError("invalid_output")`。`process.env.AI_MOCK === "1"` 时直接返回 `mock.ts` 中的固定数据，不实例化 SDK。如果 SDK 0.133.0 的类型不接受某个字段，以编译器报错为准查 SDK 源码修正，不要猜。
  - 截图提示词（`prompts.ts`）写明：今天的日期（缺年份时取不晚于今天的最近日期）；支出为正、收入为负；招商银行同时有 GBP 交易金额和 CNY 入账金额时，`amount` 用 GBP，CNY 放进 `original_*`；`hint` 只在金额或商家明显异常时给一句不超过 20 字的中文；分类只能从 9 个键里选。
  - Route Handler 从 Storage 下载图片（服务器端用调用者的会话，RLS 生效），转成 base64 发给 Claude；`export const maxDuration = 60`。
  - 未设置 `ANTHROPIC_API_KEY` 且不是 mock 模式时返回 500 和 `{ error: "还没有配置 AI 密钥" }`（在 `ai-routes.test.ts` 加一条对应测试）。
- [ ] **Step 4:** 运行 `npm test && npm run typecheck`，预期 PASS。
- [ ] **Step 5:** 提交 `feat: Claude-powered statement, receipt and categorize endpoints`。

---

### Task 7: 登录注册、布局、截图导入页

**Files:**
- Create: `src/lib/supabase/browser.ts`、`src/lib/supabase/middleware.ts`、`src/middleware.ts`
- Create: `src/app/login/page.tsx`、`src/app/signup/page.tsx`、`src/app/manifest.ts`、`src/components/BottomNav.tsx`
- Create: `src/lib/image/compress.ts`、`src/lib/data/import.ts`、`src/app/import/page.tsx`、`src/components/import/PreviewList.tsx`
- Modify: `src/app/layout.tsx`
- Test: `tests/unit/compress.test.ts`、`tests/unit/import-data.test.ts`

**Interfaces:**
- Consumes: `markDuplicates`、`dedupeKey`、`parseCsv`、`CSV_UNSUPPORTED_MESSAGE`（Task 4）；`/api/ai/statement`（Task 6）
- Produces:
  - `createBrowserSupabase(): SupabaseClient`
  - 中间件：未登录访问 `/login`、`/signup`、`/invite/*` 以外的页面时重定向到 `/login?next=<原路径>`
  - `compressImage(file: Blob, maxEdge = 1600, quality = 0.85): Promise<Blob>`；`class ImageDecodeError extends Error`；`IMAGE_DECODE_MESSAGE = "这张图片的格式无法读取（例如 iPhone 的 HEIC），请截图后再上传"`
  - `uploadImage(sb, userId: string, blob: Blob, kind: "statement" | "receipt"): Promise<string>`：返回 Storage 路径 `${userId}/${kind}/${crypto.randomUUID()}.jpg`
  - `existingDedupeKeys(sb, keys: string[]): Promise<Set<string>>`
  - `saveImport(sb, rows: (ParsedTransaction & { status: "pending" | "transfer" })[], meta: { kind: "screenshot"; filePaths: string[]; model: ModelKey }): Promise<number>`：先插入 `imports`，再批量插入 `transactions`（含 `dedupe_key`、`import_id`），返回插入行数

- [ ] **Step 1: 写失败的测试**
  - `compress.test.ts`：模拟 `createImageBitmap` 被拒绝时，`compressImage` 以 `ImageDecodeError` 拒绝；模拟一张 4000×3000 的位图时，画布尺寸为 1600×1200。
  - `import-data.test.ts`：用伪 Supabase 客户端（记录调用的对象）验证 `saveImport` 先写 `imports` 再写 `transactions`，每行带 `dedupe_key = dedupeKey(row)` 和 `import_id`；`uploadImage` 返回的路径以 `${userId}/statement/` 开头、以 `.jpg` 结尾。
- [ ] **Step 2:** 运行测试，预期 FAIL。
- [ ] **Step 3:** 实现以上模块和页面：
  - 登录、注册页：邮箱 + 密码，注册时填昵称（写入 `display_name` 元数据），支持 `?next=` 回跳。
  - 布局：底部导航“面板 / 导入 / 待处理（显示数字角标）/ 设置”；PWA manifest 名称为“分账本”。
  - 导入页：两个入口。“上传截图”可多选，每张依次压缩、上传、调用接口，显示进度“正在识别第 2/5 张”；某张失败不影响其他张，失败的那张显示错误和“重试”；接口返回 0 笔交易时显示“没识别出交易，换一张更清楚的截图，或用 Opus 5.5 重试”。全部完成后进入 `PreviewList`：每行可改日期、商家、金额、分类，可删除；重复行默认不勾选，标“可能重复”；底部有“用 Opus 5.5 重新识别”和“导入 N 笔”。“上传 CSV”入口读取文本后调用 `parseCsv`，失败时显示 `CSV_UNSUPPORTED_MESSAGE`。
- [ ] **Step 4:** 运行 `npm test && npm run typecheck && npm run build`，预期 PASS。
- [ ] **Step 5:** 设置 `AI_MOCK=1` 运行 `npm run dev`，用 Playwright 在 390px 视口截图检查登录页和导入预览页（mock 返回 3 笔），确认布局正常。
- [ ] **Step 6:** 提交 `feat: auth, app shell and screenshot import flow`。

---

### Task 8: 滑卡确认页（方案 C）和平均分

**Files:**
- Create: `src/lib/review/queue.ts`、`src/lib/data/review.ts`
- Create: `src/components/review/HandStrip.tsx`、`TxCard.tsx`、`SwipeDeck.tsx`、`SplitSheet.tsx`
- Create: `src/app/review/page.tsx`
- Test: `tests/unit/queue.test.ts`

**Interfaces:**
- Consumes: `equalSplit`（Task 2）、`historyHint`、`formatCnDate`、`weekdayCn`（Task 3）、`set_transaction_split`、`reset_transaction`（Task 5）
- Produces:
  - `type Choice = "personal" | "shared" | "later"`
  - `type QueueState = { order: string[]; currentId: string | null; decided: Record<string, Choice>; history: { id: string; choice: Choice; index: number }[] }`
  - `initQueue(ids: string[]): QueueState`；`decide(s, id, choice): QueueState`；`undo(s): { state: QueueState; undone: { id: string; choice: Choice } | null }`；`jump(s, id): QueueState`（跳到已处理的交易时，把它放回队列并清除其决定）
  - `loadReviewData(sb): Promise<{ items: ReviewItem[]; contacts: Contact[] }>`，其中 `ReviewItem` = 交易行 + `hint: string | null`（由 `historyHint` 根据同一 `normalizeMerchant` 的最近一笔已处理交易生成）+ `sameDay: { time: string | null; merchant: string; amountPence: number; isCurrent: boolean }[]`
  - `savePersonal(sb, txId)`、`saveLater(sb, txId)`、`saveShares(sb, txId, shares: Share[])`、`resetTx(sb, txId)`、`updateCategory(sb, txId, category: Category)`、`createContact(sb, name: string): Promise<Contact>`（`Contact` 来自 `src/lib/db/types.ts`）
  - 卡片上点分类标签弹出 9 个分类供选择，选中后调用 `updateCategory`

- [ ] **Step 1: 写失败的测试** `queue.test.ts`

```ts
let s = initQueue(["a", "b", "c"]);
s = decide(s, "a", "personal");
expect(s.order).toEqual(["b", "c"]); expect(s.currentId).toBe("b");
s = decide(s, "b", "later");
expect(s.order).toEqual(["c", "b"]);            // 稍后：排到队尾
s = decide(s, "c", "shared");
s = decide(s, "b", "later");                    // 只剩“稍后”的交易：队列结束，不再循环
expect(s.order).toEqual([]); expect(s.currentId).toBeNull();
const u = undo(s);
expect(u.undone).toEqual({ id: "b", choice: "later" }); expect(u.state.currentId).toBe("b");
s = jump(initQueue(["a", "b"]), "b"); expect(s.currentId).toBe("b");
let t = decide(initQueue(["a", "b"]), "a", "personal");
t = jump(t, "a"); expect(t.order).toContain("a"); expect(t.decided.a).toBeUndefined();
```

- [ ] **Step 2:** 运行测试，预期 FAIL。
- [ ] **Step 3:** 实现状态机和页面。交互按 spec §5 和已确认的原型：
  - 上方手牌条：小牌显示商家和金额，已处理的变灰并带“自己 / 一起 / 稍后”标签，当前这笔上移高亮，点击调用 `jump`。
  - 叠卡用 Pointer Events 拖动：水平位移超过 100px 判定左右；向上超过 100px 且水平位移小于 80px 判定“稍后”；松手未达阈值时回弹。卡片设置 `touch-action: none`。
  - `SplitSheet` 是底部弹出面板，层级高于卡片（之前原型的 bug：面板被卡片遮住，这次不能再出现）。面板内容：联系人多选、“我”默认选中、“+ 写个新名字”输入框，以及平均分 / 按小票分两个选项。平均分时实时预览每人金额。
  - 写库失败时卡片回到原位，显示“保存失败，请重试”，不推进队列。
  - 撤销：`undo` 后调用 `resetTx`。
  - 遵守 `prefers-reduced-motion`。
- [ ] **Step 4:** 运行 `npm test && npm run typecheck && npm run build`，预期 PASS。
- [ ] **Step 5:** 提交 `feat: swipe review deck with equal split`。

---

### Task 9: 按小票分账

**Files:**
- Create: `src/components/review/ReceiptAssigner.tsx`、`src/lib/data/receipt.ts`
- Modify: `src/components/review/SplitSheet.tsx`（选择“按小票分”后进入 ReceiptAssigner）
- Test: `tests/unit/receipt-data.test.ts`

**Interfaces:**
- Consumes: `receiptSplit`、`unassignedLines`（Task 2）；`/api/ai/receipt`（Task 6）；`uploadImage`、`compressImage`（Task 7）；`saveShares`（Task 8）
- Produces:
  - `saveReceipt(sb, txId: string, r: { imagePath: string; totalPence: number; model: ModelKey; lines: ReceiptLine[]; names: Record<string, string> }): Promise<void>`：写入 `receipts`（同一交易已有小票时先删除）和 `receipt_items`
  - 流程：拍照或选图 → 压缩上传 → 识别 → 商品列表。每行有归属按钮组（我 / 每个已选联系人），可多选，多选即为共享；底部实时显示每人小计。全部归属后才能确认；金额不一致时显示“小票合计 £x，银行扣款 £y，差 £z”，提供两个选项“按比例分摊”和“差额算我的”。确认时先 `saveReceipt` 再 `saveShares(receiptSplit(...))`。

- [ ] **Step 1:** 写失败的测试：`saveReceipt` 对已有小票的交易先删除再插入；`receipt_items` 每行的 `includes_me` 和 `contact_ids` 与 `ReceiptLine` 一致。
- [ ] **Step 2:** 运行测试，预期 FAIL。
- [ ] **Step 3:** 实现。识别结果允许编辑商品名和价格、删除行、手动加一行。
- [ ] **Step 4:** 运行 `npm test && npm run typecheck && npm run build`，预期 PASS。
- [ ] **Step 5:** 提交 `feat: receipt-based itemised split`。

---

### Task 10: 面板、联系人详情、结清、邀请、设置

**Files:**
- Create: `src/lib/data/dashboard.ts`、`src/lib/data/contacts.ts`、`src/lib/data/settings.ts`
- Create: `src/components/dashboard/BalanceList.tsx`、`MonthlySpend.tsx`
- Modify: `src/app/page.tsx`
- Create: `src/app/contacts/[id]/page.tsx`、`src/app/invite/[token]/page.tsx`、`src/app/settings/page.tsx`
- Test: `tests/unit/dashboard-data.test.ts`

**Interfaces:**
- Consumes: `computeBalances`（Task 3）；`shares_owed_by_me`、`monthly_spend`、`create_invite`、`accept_invite`（Task 5）
- Produces:
  - `loadBalances(sb): Promise<{ contact: Contact; pence: number }[]>`：组装 `BalanceInput`（`owedToMe` 来自我的 splits 中 `contact_id` 非空的行；`owedByMe` 来自 `shares_owed_by_me()`，按 `owner_id` 映射到我名下 `linked_user_id = owner_id` 的联系人；`settlements` 来自我的结清记录），按欠款绝对值降序排列，0 排最后
  - `loadMonthlySpend(sb, month: string /* YYYY-MM */): Promise<{ byCategory: { category: Category; pence: number }[]; totalPence: number; pendingCount: number }>`
  - `loadContactDetail(sb, contactId)`：返回相关的交易份额、对方记的份额和结清记录，按日期倒序
  - `settle(sb, contactId, amountPence, note?)`、`createInviteLink(sb, contactId): Promise<string>`（完整 URL）、`acceptInvite(sb, token): Promise<{ ok: true } | { ok: false; message: string }>`
  - `acceptInvite` 的错误文案：`invite_invalid` → “链接已失效，请让对方重新生成”；`invite_self` → “这是你自己生成的邀请链接”；`invite_already_linked` → “你已经和对方关联过了”
  - `updateSettings(sb, { displayName?: string; defaultModel?: ModelKey })`

- [ ] **Step 1:** 写失败的测试：`loadBalances` 在伪客户端数据下，把 B 记的分给我的 £2.00 映射到我名下的联系人“孙豪”并抵消；没有对应联系人的 owner 被忽略且不报错；排序正确。`acceptInvite` 把三种异常映射为上面的文案。
- [ ] **Step 2:** 运行测试，预期 FAIL。
- [ ] **Step 3:** 实现页面：
  - 面板顶部是欠款列表（“孙豪欠你 £23.40”用强调色，“你欠李明 £5.00”用另一种颜色，已结清的显示“两清”）；中间是“还有 N 笔待确认”入口；下面是本月支出总额和按分类的横向条形图（纯 CSS），可左右切换月份，有待确认交易时注明“含 N 笔待确认，按全额计”。
  - 联系人详情页：明细列表，“已结清”按钮打开金额输入（默认为当前净额），“邀请 TA 注册”按钮生成链接并复制（剪贴板失败时选中文本）。
  - 邀请页：未登录时先跳转登录或注册，然后回到邀请页确认关联。
  - 设置页：昵称、默认模型三选一（附大致单价：Haiku 约 £0.001/张，Sonnet 约 £0.02/张，Opus 约 £0.04/张）、退出登录。
- [ ] **Step 4:** 运行 `npm test && npm run typecheck && npm run build`，预期 PASS。
- [ ] **Step 5:** 提交 `feat: dashboard balances, settlements, invites and settings`。

---

### Task 11: 部署和端到端冒烟测试

**Files:**
- Create: `playwright.config.ts`、`e2e/smoke.spec.ts`、`e2e/seed-users.sql`、`README.md`

**Interfaces:**
- Consumes: 以上全部

- [ ] **Step 1:** 用 GitHub MCP 创建私有仓库 `gis-14473908/split-ledger`，`git push -u origin main`。
- [ ] **Step 2:** 在 Supabase org “Interest” 创建项目 `split-ledger`（区域 `eu-west-2`）。用 `apply_migration` 依次应用 0001、0002、0003，然后跑 `get_advisors`（security），处理所有 ERROR 级别的问题。
- [ ] **Step 3:** 在 Vercel team `gis-14473908` 创建项目并连接仓库，设置 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`（来自 `get_project_url` 和 `get_publishable_keys`），触发部署。`ANTHROPIC_API_KEY` 由用户自己在 Vercel 后台填写；填写前 AI 接口返回 Task 6 定义的“还没有配置 AI 密钥”。
- [ ] **Step 4:** 写 `e2e/seed-users.sql`，创建两个已验证邮箱的测试用户（`e2e-a@split-ledger.test`、`e2e-b@split-ledger.test`，密码用 `crypt(..., gen_salt('bf'))`，同时插入 `auth.identities`），用 `execute_sql` 执行。写 `e2e/smoke.spec.ts`（视口 390×844，`baseURL` 取 `E2E_BASE_URL`，本地 `next dev` 加 `AI_MOCK=1` 连接真实 Supabase）：A 登录 → 截图导入（mock 返回 3 笔）→ 第 1 笔左滑，第 2 笔右滑并和新联系人“测试同学”平均分，第 3 笔点“稍后” → 面板显示“测试同学欠你 £x” → A 生成邀请链接 → B 登录并打开链接 → B 的面板显示“你欠 A £x”。测试结束删除这两个用户的数据。
- [ ] **Step 5:** 运行 `E2E_BASE_URL=http://localhost:3000 npm run e2e`，预期 PASS。
- [ ] **Step 6:** 写 README：本地开发、环境变量、迁移、如何以后补 CSV 解析器（在 `CSV_PARSERS` 里注册，附打码样本作测试夹具）。提交并推送 `chore: deployment config, e2e smoke test, README`，确认 Vercel 生产部署成功、线上登录页能打开。
