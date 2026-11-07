# AI 多源自定义 Key + 内置免费额度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在设置页自行添加多家官方供应商的 AI 源（自备 key），并给应用内置源每人 $1 免费额度，超额后停用内置源。

**Architecture:** 引入「源（source）」抽象：内置源（服务端 key + Haiku/Sonnet/Opus 三档 + 免费额度）与自定义源（`ai_sources` 行 = 供应商 + 模型 + 用户 key）。`run.ts` 按接口格式分 anthropic / openai-兼容两条适配路径。路由前后对内置源做额度检查与累加。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、Supabase（Postgres + RLS + security-definer RPC）、`@anthropic-ai/sdk`、新增 `openai` SDK、zod 4、vitest。

**Spec:** `docs/superpowers/specs/2026-11-07-ai-multi-source-design.md`

## Global Constraints

- 界面文字全部中文、口语化；代码/注释/提交信息英文。
- 金额一律整数便士；AI 成本用整数 micro-USD（1e-6 美元），$1 = `1_000_000`。免费额度常量 `QUOTA_MICRO = 1_000_000`。
- 已存在名为 `ai_usage` 的表（每分钟限流日志，`ai_rate_check` 用）。额度表另起名 **`ai_quota`**，严禁复用 `ai_usage`。
- 手机优先：最大宽度 480px，弹层用底部抽屉（参考 `SplitSheet`/`BillSheet` 的 z-index 写法）；改数据按钮加 `busy` 防重复，删除点两次确认。
- `api_key` 明文入库，靠 RLS 行隔离；**浏览器端一律不 select `api_key` 列**，只用 `key_last4` 显示 `••••1234`。
- 新依赖安装带 `legacy-peer-deps`（`.npmrc` 已配）；推送前 `npm run typecheck && npm test && npm run build` 必须全绿。
- 新迁移写成 `supabase/migrations/0007_ai_sources.sql`，由用户在 Supabase SQL 控制台执行；`src/lib/db/types.ts` 手动同步。
- `AI_MOCK=1` 时所有 AI 路径行为与现状一致，usage 记 0、不累加额度。

## Review Focus

- **自定义源不得触发额度逻辑**：custom 源调用前后都不调 `ai_quota_check`/`ai_quota_add`（Task 4 测）。
- **内置额度耗尽后自定义源仍可用**：`ai_quota` 超限只影响 builtin，custom 正常（Task 4 测）。
- **非法/伪造 source key**：`parseSourceKey` 对未知前缀、空串、`custom:<非本人 uuid>` 回退或拒绝，绝不读到他人的 `ai_sources` 行（Task 1 测解析，Task 4 测 resolve 校验 `owner_id`）。
- **非视觉模型跑图片任务**：openai 适配遇上游拒答/空输出映射成 `refused`/`invalid_output` 中文提示，不 500（Task 3 测）。
- **key 泄露面**：UI 列表与读取不含 `api_key` 明文列（Task 5 测断言 select 不含 `api_key`）。

---

### Task 1: 供应商目录与 source-key 工具（纯函数）

**Files:**
- Create: `src/lib/ai/catalog.ts`
- Test: `tests/unit/ai-catalog.test.ts`

**Interfaces:**
- Consumes: `ModelKey` from `./models`。
- Produces:
  - `type ApiFormat = "anthropic" | "openai"`
  - `type ProviderDef = { id: string; label: string; apiFormat: ApiFormat; baseURL: string | null; suggestedModels: { id: string; label: string }[]; keyHint: string }`
  - `const PROVIDERS: ProviderDef[]`（7 家：`anthropic`/`openai`/`gemini`/`qwen`/`zhipu`/`moonshot`/`doubao`，端点见 spec 目录表；`anthropic.baseURL = null` 用 SDK 默认）
  - `function providerById(id: string): ProviderDef | undefined`
  - `const PRICES: Record<ModelKey, { inMicroPerTok: number; outMicroPerTok: number }>`（内置三档 token 单价，micro-USD/token；填入 Anthropic 官方定价，落地时核对）
  - `type SourceKey = string`（`builtin:haiku|sonnet|opus` 或 `custom:<uuid>`）
  - `function parseSourceKey(k: unknown): { kind: "builtin"; model: ModelKey } | { kind: "custom"; id: string } | null`（未知/空/格式错 → `null`）
  - `function builtinSourceKey(m: ModelKey): SourceKey`
  - `const DEFAULT_SOURCE_KEY: SourceKey = "builtin:sonnet"`

- [ ] **Step 1: Write the failing test** — `tests/unit/ai-catalog.test.ts`

```ts
// parseSourceKey
expect(parseSourceKey("builtin:opus")).toEqual({ kind: "builtin", model: "opus" });
expect(parseSourceKey("custom:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toEqual({ kind: "custom", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
expect(parseSourceKey("builtin:gpt")).toBeNull();
expect(parseSourceKey("custom:")).toBeNull();
expect(parseSourceKey("")).toBeNull();
expect(parseSourceKey(42)).toBeNull();
// catalog shape
expect(PROVIDERS.map((p) => p.id)).toEqual(["anthropic","openai","gemini","qwen","zhipu","moonshot","doubao"]);
expect(providerById("qwen")?.apiFormat).toBe("openai");
expect(providerById("anthropic")?.baseURL).toBeNull();
expect(Object.keys(PRICES)).toEqual(["haiku","sonnet","opus"]);
expect(PRICES.sonnet.outMicroPerTok).toBeGreaterThan(0);
```

- [ ] **Step 2: Run `npx vitest run tests/unit/ai-catalog.test.ts`** — Expected: FAIL（模块不存在）
- [ ] **Step 3: Implement `src/lib/ai/catalog.ts`** — 按上面签名实现；`custom` 的 uuid 用宽松校验（非空、含 `-`）即可，真正归属校验在 Task 4 查行时做。PRICES 数值填 Anthropic 官方 per-MTok 定价换算成 per-token micro-USD（落地时核对，注释标注来源与日期）。
- [ ] **Step 4: Run `npx vitest run tests/unit/ai-catalog.test.ts`** — Expected: PASS
- [ ] **Step 5: Commit** — `feat: add AI provider catalog and source-key helpers`

---

### Task 2: 数据库迁移与类型

**Files:**
- Create: `supabase/migrations/0007_ai_sources.sql`
- Modify: `src/lib/db/types.ts`

**Interfaces:**
- Produces（TS 类型，供后续任务）:
  - `type AiSource = { id: string; owner_id: string; label: string; provider: string; model: string; key_last4: string; created_at: string }`（**注意 `api_key` 不进 TS 行类型，避免误 select**）
  - `Profile` 增 `default_source: string | null`
- Produces（SQL，供 Task 4/5 调用）: RPC `ai_quota_check()`、`ai_quota_add(p_micro bigint)`。

- [ ] **Step 1: 写迁移 `0007_ai_sources.sql`**，包含：
  - `create table public.ai_sources (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users on delete cascade, label text not null, provider text not null, model text not null, api_key text not null, key_last4 text not null, created_at timestamptz not null default now());`
  - `create table public.ai_quota (owner_id uuid primary key references auth.users on delete cascade, used_micro bigint not null default 0, updated_at timestamptz not null default now());`
  - `alter table public.profiles add column default_source text;` 并 `update public.profiles set default_source = 'builtin:' || default_model where default_source is null;`
  - `ai_sources` 开 RLS + 四条 own 策略（select/insert/update/delete `owner_id = auth.uid()`，insert 另加 `with check`）。
  - `ai_quota` 开 RLS + select own 策略；不开放 insert/update（只经 RPC）。
  - `create function public.ai_quota_check() returns void language plpgsql security definer set search_path = public as $$ declare uid uuid := public.require_user(); begin if (select used_micro from ai_quota where owner_id = uid) >= 1000000 then raise exception 'quota_exceeded'; end if; end $$;`
  - `create function public.ai_quota_add(p_micro bigint) returns void language plpgsql security definer set search_path = public as $$ declare uid uuid := public.require_user(); begin insert into ai_quota (owner_id, used_micro, updated_at) values (uid, greatest(p_micro,0), now()) on conflict (owner_id) do update set used_micro = ai_quota.used_micro + greatest(p_micro,0), updated_at = now(); end $$;`
  - `revoke execute on function public.ai_quota_check() from public, anon;` 和 `revoke execute on function public.ai_quota_add(bigint) from public, anon;`（仿 `0004_hardening.sql`）。
- [ ] **Step 2: 同步 `src/lib/db/types.ts`** — 加 `AiSource` 类型与 `Profile.default_source`。
- [ ] **Step 3: Run `npm run typecheck`** — Expected: PASS（类型自洽）。
- [ ] **Step 4: SQL 自检** — 人工通读迁移：表、RLS、RPC、revoke 齐全；`ai_quota` 命名未与既有 `ai_usage` 冲突。（线上执行由用户在 Supabase 控制台完成，不在本任务。）
- [ ] **Step 5: Commit** — `feat: add ai_sources/ai_quota tables, default_source column and quota RPCs`

---

### Task 3: 调用适配层（anthropic + openai 兼容）

**Files:**
- Modify: `src/lib/ai/run.ts`
- Test: `tests/unit/ai-run.test.ts`

**Interfaces:**
- Consumes: `ApiFormat` from `./catalog`；`*Output` schemas from `./schemas`；`MODEL_IDS` from `./models`。
- Produces:
  - `type ResolvedSource = { kind: "builtin" | "custom"; apiFormat: ApiFormat; model: string; apiKey: string; baseURL?: string; label: string; allowServerFallback: boolean }`
  - `type RunResult<T> = { parsed: T; usage: { inputTokens: number; outputTokens: number } }`
  - `runStructured<T>(o: { source: ResolvedSource; system: string; content: Anthropic.Beta.Messages.BetaContentBlockParam[]; schema: z.ZodType<T>; mockKey: "statement"|"receipt"|"categorize"; mockCount?: number }): Promise<RunResult<T>>`
  - `toOpenAiContent(blocks: Anthropic.Beta.Messages.BetaContentBlockParam[]): OpenAI.Chat.ChatCompletionContentPart[]`（导出，供单测；image base64 → `{type:"image_url", image_url:{url:"data:<mime>;base64,<data>"}}`，text → `{type:"text", text}`）

- [ ] **Step 1: 装依赖** — `npm install openai`（带 legacy-peer-deps）。
- [ ] **Step 2: Write failing tests** — `tests/unit/ai-run.test.ts`（`vi.mock("@anthropic-ai/sdk")` 与 `vi.mock("openai")`）:

```ts
// toOpenAiContent 转换
const parts = toOpenAiContent([{ type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } }, { type: "text", text: "hi" }]);
expect(parts[0]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } });
expect(parts[1]).toEqual({ type: "text", text: "hi" });

// anthropic 格式：builtin sonnet 带 server-side fallback，返回 usage
// → mock client.beta.messages.parse 返回 { parsed_output, usage: { input_tokens:10, output_tokens:5 }, stop_reason:"end_turn" }
const r = await runStructured({ source: builtinSonnet, ... });
expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
expect(parseCall.betas).toContain("server-side-fallback-2026-07-01");

// custom anthropic 不带 fallback
expect(parseCallCustom.betas).toBeUndefined();

// openai 格式：用 baseURL+apiKey 构造 OpenAI，chat.completions.parse 被调用，图片走 image_url，usage 映射
// 上游拒答 → AiError("refused")；解析不出 → AiError("invalid_output")；APIError → AiError("upstream")
```

- [ ] **Step 3: Run `npx vitest run tests/unit/ai-run.test.ts`** — Expected: FAIL
- [ ] **Step 4: Implement `run.ts`** — `runStructured` 按 `source.apiFormat` 分派：
  - `apiFormat==="anthropic"`：现有 `client.beta.messages.parse` 路径（`new Anthropic({ apiKey: source.apiKey, ...(source.baseURL?{baseURL:source.baseURL}:{}) })`），`source.allowServerFallback` 为真才带 `betas`/`fallbacks`；读 `message.usage.{input_tokens,output_tokens}`。
  - `apiFormat==="openai"`：`new OpenAI({ apiKey: source.apiKey, baseURL: source.baseURL })`，`client.chat.completions.parse({ model: source.model, messages:[{role:"system",content:system},{role:"user",content: toOpenAiContent(content)}], response_format: zodResponseFormat(schema,"out") })`；取 `choices[0].message.parsed` 与 `completion.usage`。解析失败重试一次；分支错误映射同现有。
  - `AI_MOCK==="1"`：返回 `{ parsed: MOCKS..., usage: { inputTokens:0, outputTokens:0 } }`。
  - 保留「解析失败重试一次」与 `stop_reason==="refusal"` → `refused`。
- [ ] **Step 5: Run `npx vitest run tests/unit/ai-run.test.ts`** — Expected: PASS
- [ ] **Step 6: Commit** — `feat: dual-format AI adapter (anthropic + openai-compatible) returning usage`

---

### Task 4: 源解析 + 路由集成（额度检查/累加）

**Files:**
- Create: `src/lib/ai/sources.ts`（server-only）
- Modify: `src/lib/ai/route-helpers.ts`, `src/lib/ai/errors.ts`
- Modify: `src/app/api/ai/{statement,receipt,categorize}/route.ts`
- Test: `tests/unit/ai-routes.test.ts`（扩充）

**Interfaces:**
- Consumes: `parseSourceKey`,`providerById`,`PRICES`,`DEFAULT_SOURCE_KEY` from `./catalog`；`ResolvedSource`,`runStructured` from `./run`；`MODEL_IDS`,`MODEL_LABEL` from `./models`。
- Produces:
  - `resolveSource(sb, userId, key: string | undefined): Promise<ResolvedSource>`（in `sources.ts`）：`parseSourceKey` 解析；builtin → env `ANTHROPIC_API_KEY` + `MODEL_IDS[model]` + `allowServerFallback = model!=="haiku"` + `label = MODEL_LABEL[model]`；custom → `sb.from("ai_sources").select("*").eq("id",id).eq("owner_id",userId).single()`（查不到则 `AiError("bad_request")`），`providerById(provider)` 给 `apiFormat`/`baseURL`，`label = row.label`。
  - `AiContext = { sb; userId; source: ResolvedSource }`（替换原 `model`）。
  - `costMicro(model: ModelKey, usage): number`（in `sources.ts`，用 `PRICES`）。
  - `errors.ts`：`AiErrorCode` 加 `"quota_exceeded"`；`AI_ERROR_STATUS.quota_exceeded = 402`；`AI_ERROR_MESSAGE.quota_exceeded = "内置免费额度已用完，请在设置里添加你自己的 AI 源"`。

- [ ] **Step 1: Write failing tests** — 在 `ai-routes.test.ts` 加（`fakeSupabase` 扩 `defaultSource`、`ai_sources.single`、`rpc` 记录名字）:

```ts
// builtin 超额 → 402 + 中文；rpc ai_quota_check 以错误 "quota_exceeded" 抛
it("blocks builtin source when free quota is used up"): status 402, error "内置免费额度已用完，请在设置里添加你自己的 AI 源"
// builtin 成功后累加：rpcCalls 含 { fn:"ai_quota_check" } 且之后 { fn:"ai_quota_add", args:{ p_micro: >0 } }
// custom 源：body.source="custom:<uuid>"，resolve 到 ai_sources 行；rpcCalls 不含 ai_quota_check / ai_quota_add；仍含 ai_rate_check
// 伪造 custom（single 返回 {data:null}）→ 400
// 响应体用 source label：body.source === "Opus 5.5"（builtin:opus）
```

- [ ] **Step 2: Run `npx vitest run tests/unit/ai-routes.test.ts`** — Expected: FAIL
- [ ] **Step 3: Implement** —
  - `errors.ts` 加码。
  - `sources.ts`：`resolveSource` + `costMicro`。
  - `route-helpers.ts`：`withAi` 改为 `source = await resolveSource(sb, user.id, body.source as string | undefined ?? profile.default_source)`；`ai_rate_check` 对所有源保留（`p_model` 传 `source.label`）；若 `source.kind==="builtin"`：调用前 `sb.rpc("ai_quota_check")`（error 含 `quota_exceeded` → `AiError("quota_exceeded")`，否则 `upstream`）；`run` 返回后用 `costMicro` 调 `sb.rpc("ai_quota_add",{p_micro})`。`no_key` 判断：builtin 且无 env 且非 mock。`AiContext` 带 `source`。
  - 三个 route：把 `ctx.model` 用法改成 `ctx.source`；`runStructured({ source: ctx.source, ... })` 取 `.parsed`；响应里 `model` 字段改名 `source: ctx.source.label`。
- [ ] **Step 4: Run `npx vitest run tests/unit/ai-routes.test.ts`** — Expected: PASS
- [ ] **Step 5: Commit** — `feat: resolve AI source per request and enforce built-in free quota`

---

### Task 5: 源的数据层（UI CRUD，不回显 key）+ 默认源

**Files:**
- Create: `src/lib/data/sources.ts`
- Modify: `src/lib/data/settings.ts`
- Test: `tests/unit/sources-data.test.ts`

**Interfaces:**
- Consumes: `AiSource` from `../db/types`。
- Produces:
  - `listSources(sb): Promise<AiSource[]>` — `select("id, owner_id, label, provider, model, key_last4, created_at")`（**显式列，不含 `api_key`**）`.order("created_at")`。
  - `addSource(sb, userId, s: { label: string; provider: string; model: string; apiKey: string }): Promise<void>` — insert `{...s(去掉 apiKey), owner_id: userId, api_key: s.apiKey.trim(), key_last4: s.apiKey.trim().slice(-4) }`。
  - `deleteSource(sb, id: string): Promise<void>`。
  - `readQuota(sb): Promise<number>` — 读 `ai_quota.used_micro`（无行返回 0）。
  - `settings.ts`：`updateSettings` 的 patch 增 `defaultSource?: string` → 写 `default_source`。

- [ ] **Step 1: Write failing tests** — `tests/unit/sources-data.test.ts`（`recordingSupabase`）:

```ts
// listSources 的 select 不含 api_key
await listSources(sb); const sel = sb.calls.find(c=>c.op==="select"); expect(String(sel.args[0])).not.toContain("api_key");
// addSource 写入 key_last4 = 后四位，且 api_key 原文
await addSource(sb, USER, { label:"我的Q", provider:"qwen", model:"qwen3-vl-plus", apiKey:"sk-abcd1234" });
const ins = sb.calls.find(c=>c.op==="insert"); expect(ins.args[0]).toMatchObject({ owner_id: USER, key_last4: "1234", api_key: "sk-abcd1234" });
// readQuota 无行返回 0
// updateSettings 写 default_source
```

- [ ] **Step 2: Run `npx vitest run tests/unit/sources-data.test.ts`** — Expected: FAIL
- [ ] **Step 3: Implement `data/sources.ts` 与 `settings.ts` 改动**。
- [ ] **Step 4: Run `npx vitest run tests/unit/sources-data.test.ts`** — Expected: PASS
- [ ] **Step 5: Commit** — `feat: data layer for AI sources (no key readback) and default source`

---

### Task 6: 设置页 UI（源管理 + 额度条）

**Files:**
- Create: `src/components/settings/SourceSheet.tsx`（底部抽屉：选供应商 → 选/填模型 → 填 key → 命名）
- Modify: `src/app/settings/page.tsx`
- Test: `tests/unit/source-sheet.test.tsx`（若项目已有组件测试基建则加；否则本任务以数据层测试 + 人工验证为准）

**Interfaces:**
- Consumes: `PROVIDERS`,`providerById` from `@/lib/ai/catalog`；`listSources`,`addSource`,`deleteSource`,`readQuota` from `@/lib/data/sources`；`MODEL_KEYS`,`MODEL_LABEL` from `@/lib/ai/models`。
- Produces: 设置页新增「AI 源」区块；`profiles.default_source` 的单选写入。

- [ ] **Step 1: 实现 `SourceSheet.tsx`** — 底部抽屉表单：① `<select>` 供应商（`PROVIDERS`）② 模型：`providerById(provider).suggestedModels` 下拉 + 「其他」切到手填 `<input>`（旁注「请填支持图片识别的模型」）③ key `<input type="password">` ④ label `<input>`。保存调 `addSource`，`busy` 防重复，成功回调刷新列表。参考 `BillSheet`/`SplitSheet` 的抽屉与 z-index。
- [ ] **Step 2: 改 `settings/page.tsx`** — 新「AI 源」区块：内置三档单选（复用现有「默认识别模型」块，语义=内置源用哪档）+ 额度条「已用 $x.xx / $1.00」（`readQuota()/1e6`）；自定义源列表（label + 供应商 label + `••••{key_last4}` + 删除点两次确认）；「默认源」单选（内置档 / 各自定义源）→ `updateSettings({ defaultSource })`；「添加源」按钮开 `SourceSheet`。
- [ ] **Step 3: Verify** — `npm run typecheck` PASS；`npm run dev` 手动过一遍：添加源、删除、切默认、额度条显示（可用 `AI_MOCK=1`）。若加了组件测试则 `npx vitest run tests/unit/source-sheet.test.tsx` PASS。
- [ ] **Step 4: Commit** — `feat: settings UI for managing AI sources and free-quota meter`

---

### Task 7: 识别/重识别入口改用「源」

**Files:**
- Modify: `src/components/review/ReceiptAssigner.tsx`, `src/components/bills/EditSplit.tsx`
- Modify: `src/lib/data/import.ts` 及其调用页（import 页面传 source）
- Modify: `src/lib/data/{import,receipt}.ts` 的 `model_used` 写入（改存源 label）
- Test: `tests/unit/ai-routes.test.ts`（已在 Task 4 覆盖响应 `source` 字段）+ 相关数据层测试更新

**Interfaces:**
- Consumes: `listSources` + 内置档 from catalog/models；路由响应新增 `source` 字段（Task 4）。
- Produces: 前端请求体 `{ imagePath/items, source: <sourceKey> }`；`model_used` 存响应 `source`（label 文本）。

- [ ] **Step 1: 更新受影响的数据层/组件测试** — `receipt-data.test.ts`/`import-data.test.ts` 里 `model` 入参改 `sourceLabel`，断言 `model_used` 存 label 文本；`ReceiptAssigner` 的 `recognise` 发送 `source`。先改成期望新行为（FAIL）。
- [ ] **Step 2: Run 相关测试** — Expected: FAIL
- [ ] **Step 3: Implement** —
  - `ReceiptAssigner.tsx`/`EditSplit.tsx`：模型下拉换成「源下拉」（内置三档 `builtin:*` + `listSources()` 的 `custom:<id>`，显示 label）；state 由 `ModelKey` 改为 `sourceKey: string`；请求体发 `source`；识别结果里的 `model` 读为 `source`（label）存 `model_used`。
  - `import.ts`/`receipt.ts`：`meta.model`/`r.model` 改为 `sourceLabel: string`，写 `model_used: sourceLabel`。
  - import 页面：传当前所选 source（默认 `profiles.default_source`）。
  - 兼容旧 `model_used`（"sonnet" 等）：只做展示，不迁移。
- [ ] **Step 4: Run `npm test`** — Expected: PASS（全量）
- [ ] **Step 5: Commit** — `feat: pick AI source (not model tier) in recognition and re-recognition flows`

---

### Task 8: 收尾验证

**Files:** 无新增（可更新 `CLAUDE.md` 的「环境变量/已知问题」与 RPC 列表）。

- [ ] **Step 1:** `npm run typecheck` PASS
- [ ] **Step 2:** `npm test` PASS
- [ ] **Step 3:** `npm run build` PASS
- [ ] **Step 4:** 更新 `CLAUDE.md`：RPC 列表加 `ai_quota_check`/`ai_quota_add`；「已知问题」记「api_key 明文存储」「成本为估算、先用后检查有极小超支窗口」；供应商端点/模型 id 落地核对结果。
- [ ] **Step 5: Commit** — `docs: note multi-source AI setup in CLAUDE.md`
