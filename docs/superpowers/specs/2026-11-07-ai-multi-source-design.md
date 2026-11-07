# 设计：AI 多源自定义 Key + 内置免费额度

日期：2026-11-07 · 分支：`claude/ai-multi-source-apikey-ejz4he`

## 背景与目标

目前所有 AI 识别（截图识流水 `statement`、小票识商品 `receipt`、商家分类 `categorize`）都只走服务端一个 `ANTHROPIC_API_KEY`，模型固定为 Haiku/Sonnet/Opus 三档（`src/lib/ai/models.ts`、`run.ts`）。

用户（本 App 的作者兼主要使用者）希望：

1. **多源自定义**：用户能在设置页自己添加「AI 源」，支持 **多个官方供应商**（不止 Anthropic，还要 OpenAI / Google Gemini / 阿里通义 Qwen-VL / 智谱 GLM-V 等），填各家官方 API Key，用自己的钱跑识别。
2. **只用支持图片识别的模型**：statement/receipt 是视觉任务，所以源能选的模型限定在「支持图片输入」的范围内，按官方供应商分类。
3. **内置源保留 + 免费额度**：应用内置的服务端 key（含 Haiku/Sonnet/Opus 三档）继续存在、仍是默认，但给每个用户 **$1 USD 的免费额度**；累计用量超过 $1 后，内置源停用，提示用户去配置自己的源。自定义源用的是用户自己的 key，不限额。

不做（YAGNI）：
- 不做自由填 `base_url`（只用各官方供应商的固定 base_url，避免任意 SSRF/配置复杂度）。
- 不做付费/充值系统；超额后就是「用自己的 key」，没有向用户收款的环节。
- 不做非视觉专用源的特殊分流；每个源要么能做全部三类任务，要么由用户自担（见「视觉能力」）。
- 内置三档不迁移成数据库种子行，继续用代码常量。

## 术语：AI 源（source）

一次 AI 调用总是落在某个「源」上。源分两类：

- **内置源（built-in）**：`provider = "builtin"`，用服务端 `ANTHROPIC_API_KEY`，模型是现有三档之一（`haiku`/`sonnet`/`opus`）。受 **$1 免费额度** 约束。不存数据库，由代码常量描述。
- **自定义源（custom）**：存在新表 `ai_sources` 的一行，属于某个用户。由「供应商 + 模型 id + 该供应商官方 API Key」组成，用用户自己的 key，**不计免费额度**（但仍受现有每分钟限流）。

`profiles` 增加 `default_source`（text），记录用户默认用哪个源：
- `"builtin:haiku"` / `"builtin:sonnet"` / `"builtin:opus"` 指内置三档；
- `"custom:<uuid>"` 指某个自定义源行。
- 缺省（null 或非法值）回退到 `"builtin:sonnet"`，与现状一致。

> 字符串化的 source key 取代了原来单纯的 `ModelKey`。旧的 `default_model`（haiku/sonnet/opus）保留不动，用于内置三档的「用哪一档」，但选择「用哪个源」的入口统一走 `default_source`。迁移时 `default_source` 默认按旧 `default_model` 推出 `"builtin:<default_model>"`。

## 供应商目录（catalog）

新文件 `src/lib/ai/catalog.ts`，**代码内写死稳定部分**（供应商身份、接口格式、官方 base_url、推荐视觉模型）。因为各家模型 ID 更新很快，模型采用「**推荐下拉 + 可手填**」：目录给每家几个当前推荐的视觉模型作为下拉项，同时允许用户手填任意模型名，各家出新模型时无需改代码重新部署。

目录结构（示意，具体模型 id 以落地时为准，见「待确认」）：

```ts
type ApiFormat = "anthropic" | "openai"; // openai = OpenAI 兼容 Chat Completions

type ProviderDef = {
  id: string;            // "anthropic" | "openai" | "gemini" | "qwen" | "zhipu"
  label: string;         // 显示名："Anthropic" / "OpenAI" / "Google Gemini" / "阿里通义" / "智谱 GLM"
  apiFormat: ApiFormat;
  baseURL: string;       // 官方 OpenAI 兼容端点；anthropic 格式留空用 SDK 默认
  suggestedModels: { id: string; label: string }[]; // 推荐视觉模型，可手填覆盖
  keyHint: string;       // 中文提示：去哪拿 key
};
```

初版覆盖的供应商与官方端点（base_url 稳定，模型为推荐值）：

| 供应商 | id | 接口格式 | 官方 base_url | 推荐视觉模型（可手填） |
|---|---|---|---|---|
| Anthropic | `anthropic` | anthropic | SDK 默认 `https://api.anthropic.com` | `claude-sonnet-5-5`、`claude-opus-5-5`、`claude-haiku-5-5` |
| OpenAI | `openai` | openai | `https://api.openai.com/v1` | 当前 GPT 视觉模型（落地时确认 id） |
| Google Gemini | `gemini` | openai | `https://generativelanguage.googleapis.com/v1beta/openai/` | 当前 Gemini Flash/Pro 视觉模型 |
| 阿里通义 Qwen-VL | `qwen` | openai | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`（国际）/ `https://dashscope.aliyuncs.com/compatible-mode/v1`（国内） | `qwen3-vl-plus` 等 |
| 智谱 GLM-V | `zhipu` | openai | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.6v` 等 |
| 月之暗面 Kimi | `moonshot` | openai | `https://api.moonshot.cn/v1`（国内）/ `https://api.moonshot.ai/v1`（国际） | Kimi 视觉模型（落地时确认 id） |
| 字节豆包 | `doubao` | openai | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-*-vision` 或接入点 id（落地时确认） |

> 初版共 7 家供应商。再加一个供应商 = 往目录加一行 + 确认端点，不改适配层。
> 豆包（火山方舟）历史上用「接入点 id（ep-xxxx）」而非模型名调用，现也支持直接填模型名；落地时确认，`model` 字段两种都能填（手填兜底）。

**视觉能力**：下拉里只列支持图片输入的推荐模型。用户手填模型名属于「自担」——若填了不支持视觉的模型，statement/receipt 会被上游拒绝或返回空，映射成现有的 `refused`/`invalid_output` 中文提示。界面在手填框旁给一句提示「请填支持图片识别的模型」。

## 调用适配层（重构 `src/lib/ai/run.ts`）

把「用哪个 key、哪个端点、哪个模型、哪种接口格式」从 `run.ts` 内部解耦出来。

- `runStructured` 的入参从 `{ model: ModelKey, ... }` 改为 `{ source: ResolvedSource, ... }`，其中
  ```ts
  type ResolvedSource = {
    kind: "builtin" | "custom";
    apiFormat: "anthropic" | "openai";
    model: string;        // 具体模型 id
    apiKey: string;       // 内置 = 服务端 env；自定义 = 用户行里的 key
    baseURL?: string;     // openai 格式用；anthropic 自定义源也可带
    label: string;        // 展示/存储用的标签
    allowServerFallback: boolean; // 仅内置 sonnet/opus 为 true
  };
  ```
- **anthropic 适配**：沿用现有 `client.beta.messages.parse` + `betaZodOutputFormat(schema)`。`allowServerFallback` 为真时带 `server-side-fallback` beta（仅内置 sonnet/opus）。自定义 Anthropic 源不带 fallback。
- **openai 适配**：新装依赖 `openai`。用 `new OpenAI({ apiKey, baseURL })` + `client.chat.completions.parse`（`zodResponseFormat` from `openai/helpers/zod`）做结构化输出；若某供应商不支持 `json_schema`，回退 `response_format: { type: "json_object" }` + 文本 JSON 解析。图片内容块从 Anthropic 的 `{type:"image", source:{type:"base64",...}}` 转成 OpenAI 的 `{type:"image_url", image_url:{ url: "data:<mime>;base64,<...>" }}`。
- 两种格式都保留「解析失败重试一次」的现有逻辑；上游 API 错误 → `AiError("upstream")`，拒答 → `refused`，解析不出 → `invalid_output`。
- 返回值扩展为 `{ parsed: T, usage: { inputTokens: number; outputTokens: number } }`，供计费使用（内置源才用）。`AI_MOCK=1` 时 usage 返回 0。

图片内容的构造目前在 `route-helpers.ts` 的 `downloadImage` 里产出 Anthropic 形状；适配层负责在 openai 格式时转换，调用方（routes）无需改动图片构造。

## 内置免费额度

**成本模型**：按 token 用量 × 单价估算美元成本，累计到用户头上。

- 单价表放 catalog：内置三档的 input/output 每百万 token 美元价（`PRICES: Record<ModelKey, {in:number;out:number}>`）。
- 单位：内部以 **美分的千分之一（micro-USD，即 1e-6 美元）为整数** 存储，避免浮点；$1 = 1_000_000。
- 每次 **内置源** 调用成功后：`cost = inTokens*priceIn + outTokens*priceOut`（换算到 micro-USD 整数），累加到用户用量。
- 自定义源：不计费、不累加。

**存储与检查**：新 security-definer RPC（仿 `ai_rate_check`）：
- `ai_quota_check()`：读当前用户累计用量，若 `>= QUOTA_MICRO`（1_000_000）抛 `rate_limited`-风格错误（实际用新码 `quota_exceeded`）。内置源调用**前**执行。
- `ai_quota_add(p_micro bigint)`：原子累加当前用户用量。内置源调用**后**执行。
- 用量存新表 `ai_usage(owner_id uuid pk, used_micro bigint not null default 0, updated_at timestamptz)`，RLS 只读自己的行；累加只经 RPC（security definer）。

**超额行为**：内置源触发 `quota_exceeded` → 返回中文提示「内置免费额度已用完，请在设置里添加你自己的 AI 源」。自定义源完全不受影响。

**展示**：设置页内置源区块显示「已用 $x.xx / $1.00」进度条（读 `ai_usage.used_micro`）。

> 说明：成本是**估算**（按官方 token 单价），不是 Anthropic 账单的精确值；对「给点免费额度然后让用户自付」这个目的足够。先用后检查会有极小超支窗口（一次调用的量），可接受。

## 存储与安全

- 新表 `ai_sources`：
  ```sql
  id uuid pk default gen_random_uuid()
  owner_id uuid not null references auth.users on delete cascade
  label text not null              -- 用户起的显示名
  provider text not null           -- catalog provider id
  model text not null              -- 具体模型 id
  api_key text not null            -- 明文；靠 RLS 行隔离
  key_last4 text not null          -- 展示用后四位
  created_at timestamptz default now()
  ```
  RLS：select/insert/update/delete 均 `owner_id = auth.uid()`。
- **Key 不回显**：设置页列表与读取**不 select `api_key` 列的明文**到浏览器，只用 `key_last4` 显示「••••1234」。新增/修改时是写入（insert/update），不读回。服务端 AI 路由用用户 session 的 `sb` 读整行（含 key）执行调用——与浏览器同为 `authenticated` 角色，但浏览器端代码本身不去 select key，且 RLS 已保证跨用户隔离（用户至多看到自己的 key，不构成泄露）。
- 明文存储已在设计讨论中向用户说明并接受。pgcrypto 加密视为过度设计，不做。

## UI 改动

- **设置页 `src/app/settings/page.tsx`**：新增「AI 源」区块：
  - 内置源：显示三档单选（复用现有「默认识别模型」区，语义变为「内置源用哪档」）+ 免费额度进度条。
  - 自定义源：列出已添加的源（label + 供应商 + ••••后四位 + 删除），一个「添加源」按钮打开底部抽屉（复用 `SplitSheet`/`BillSheet` 的抽屉写法与 z-index）。
  - 「默认源」单选：内置某档 或 某个自定义源 → 写 `profiles.default_source`。
  - 添加/编辑抽屉：① 选供应商（下拉）② 选模型（推荐下拉 + 可手填）③ 填 key（password 输入）④ 起个名字。保存校验非空；按钮防重复点击（`busy`）；删除点两次确认。
- **识别/重识别入口**：
  - `src/components/review/ReceiptAssigner.tsx`、`src/components/bills/EditSplit.tsx`：原「模型下拉（haiku/sonnet/opus）」换成「源下拉」（内置三档 + 自定义源）。请求体从 `{ model }` 改为 `{ source }`（source key 字符串）。
  - import 流程（`src/lib/data/import.ts`）同理传 source key。
- **`model_used` 字段语义**：`imports.model_used` / `receipts.model_used` 改存**源的显示标签**（free text，如 "Sonnet 5.5"、"我的 Qwen"），兼容旧的 "sonnet" 等值（旧值照常显示）。不新增列。

## API 路由与错误

- `src/lib/ai/route-helpers.ts` 的 `withAi`：
  - 解析请求里的 `source`（字符串 source key）；非法则回退用户的 `default_source`；再非法回退 `builtin:sonnet`。
  - 解析成 `ResolvedSource`：内置 → 用 env key + 单价表 + `allowServerFallback`；自定义 → 查 `ai_sources` 行（校验属于该用户）+ catalog 端点。
  - 内置源：调用前 `ai_quota_check`（超额 → `quota_exceeded`）；保留现有 `ai_rate_check`（每分钟 10 次）对所有源生效。
  - 调用后：内置源用返回的 usage 调 `ai_quota_add`。
  - `AiContext` 从 `{ sb, userId, model }` 改为 `{ sb, userId, source }`。
- `src/lib/ai/errors.ts` 增错误码 `quota_exceeded`：status 402，中文「内置免费额度已用完，请在设置里添加你自己的 AI 源」。`no_key` 文案在「内置没配 env 且无自定义源」时沿用。

## 数据库迁移 `supabase/migrations/0007_ai_sources.sql`

1. `create table ai_sources ...` + RLS 四条策略。
2. `create table ai_usage ...` + RLS select 自己；`revoke` 普通写。
3. `alter table profiles add column default_source text`（迁移现有行 `= 'builtin:' || default_model`）。
4. `ai_quota_check()` / `ai_quota_add(bigint)` security-definer 函数；`revoke execute ... from public, anon`（仿 0004 对 `ai_rate_check` 的加固）。

`src/lib/db/types.ts` 同步：新增 `AiSource` 类型、`Profile.default_source`。

## 测试

- `tests/unit/ai-adapter.test.ts`：mock `@anthropic-ai/sdk` 与 `openai`，验证两种格式的请求构造（图片块转换、模型/端点/key 选择、fallback 仅内置）与解析/重试。
- `tests/unit/ai-quota.test.ts`：用量累加、超额抛 `quota_exceeded`、自定义源不计费（用 `fake-supabase` + mock RPC）。
- `tests/unit/catalog.test.ts`：source key 解析（`builtin:*` / `custom:*` / 非法回退）、resolve 逻辑。
- 数据层：`ai_sources` 读写（`fake-supabase`，key 不回显路径）。
- SQL 测试（`npm run test:db`，Linux Postgres）：`ai_quota_*` RPC、RLS 隔离。
- 回归：现有 statement/receipt/categorize 在 `AI_MOCK=1` 下行为不变。

## 兼容性与风险

- **不配任何自定义源、额度未超** → 行为与现状完全一致（默认 `builtin:sonnet`）。
- **额度已超但没配源** → 内置源报 `quota_exceeded`；需引导用户加源。初次上线前（给自己用）额度表为空，不影响。
- 新装 `openai` 依赖（注意 `.npmrc` 的 `legacy-peer-deps`）。
- 推送前必须 `npm run typecheck && npm test && npm run build` 全绿（Vercel 用同样构建）。
- 迁移需用户在 Supabase SQL 控制台执行 `0007`（或经 Supabase MCP 确认后执行）。

## 待确认（落地时处理，不阻塞本设计）

- 各供应商「推荐视觉模型」的精确当前模型 id：本会话网络白名单未放行 `docs.anthropic.com` / `ai.google.dev` / `www.alibabacloud.com` 等，无法现场核对。落地时在各控制台/文档确认；手填能力保证即使推荐值过时也可用。
- 内置三档 token 单价数值：以 Anthropic 官方定价为准，落地时填入 `PRICES`。
