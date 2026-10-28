# 分账本 (split-ledger)：给 Claude 的项目说明

## 和用户沟通
- 用户是在英国（曼彻斯特）读书的中国学生，**所有回复都用中文**。代码、注释、提交信息保持英文，和现有代码一致。
- 用户主要在手机上使用这个 App，也常在手机上和 Claude 对话：回复要简短，给能直接复制的命令，不要让用户去找文件。
- 用户的开发电脑是 Windows（项目在 `D:\项目\分钱`，PowerShell），另有一台 MacBook。

## 这是什么
一个以手机为主的网页 App，部署在 Vercel，数据存在 Supabase。主要功能：
- 用截图（Claude 识别）或 CSV 导入银行流水。用户用 HSBC、Monzo、Lloyds、招商银行（Visa 卡也是英镑消费）。
- 自动分类，然后在「待处理」里用卡片逐笔左右滑：我自己的 / 一起的 / 稍后。
- 「一起的」可以平均分，也可以拍小票、逐个商品选归属（按小票分）。
- 面板显示每个同学欠我 / 我欠 TA 多少；同学详情页有明细，可以记还款和起始欠款（旧账）。
- 「账单」页列出所有导入的账单，可以改商家 / 日期 / 金额 / 分类、改类型、删除、手动记账；分过的账能看到小票明细，能「修改分账」或「去掉」某个人，所有人的份额一起重算。
- 多用户：可以只记名字；用邀请链接关联对方账号后，双方的账会互相抵消。

线上地址：https://split-ledger-beige.vercel.app 。学校网络（Jisc）把这个 vercel.app 域名误判成恶意网站，连学校 Wi‑Fi 时打不开，用手机流量可以；长期办法是换自己的域名。

## 技术栈
Next.js 16（App Router；中间件文件是 `src/proxy.ts`，不是 `middleware.ts`）、React 19、Tailwind 4、TypeScript、Supabase（Postgres + RLS + Storage + Auth）、`@anthropic-ai/sdk`、zod 4、papaparse、vitest、Playwright。

## 常用命令
```bash
npm install            # .npmrc 里有 legacy-peer-deps=true，别删
npm run dev            # http://localhost:3000
npm test               # vitest 单元测试（tests/unit）
npm run typecheck      # tsc --noEmit
npm run build          # 推送前跑一遍，Vercel 用的是同样的构建
npm run test:db        # SQL 测试：需要 Linux 上的 Postgres 16，Windows 上跑不了
```
项目没有 ESLint 配置，检查就靠 typecheck、测试和 build。

## 环境变量（`.env.local`，不提交）
- `NEXT_PUBLIC_SUPABASE_URL` = `https://hmekrexuepbkcckljdad.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`：Supabase 的 publishable key（可以公开）
- `ANTHROPIC_API_KEY`：只在服务端用，绝不能出现在浏览器代码里
- `AI_MOCK=1`：AI 接口返回 `src/lib/ai/mock.ts` 里的固定结果，本地开发和测试用，不花钱

**注意：本地默认连的就是线上数据库**，本地的增删改会直接影响用户的真实账单。做破坏性测试前先提醒用户，或者另建一个开发用的 Supabase 项目。

## 部署
- 推到 GitHub `gis-14473908/split-ledger` 的 `main` 分支，Vercel 会自动部署到生产环境（区域 lhr1），一般一分钟左右。所以推之前必须 typecheck、测试、build 全部通过。
- Vercel 项目 `split-ledger`（prj_ukVRSUBdUhcmjvDtZITHoJs9yOEV）；生产环境变量在 Vercel 项目设置里。
- Supabase 项目 `hmekrexuepbkcckljdad`（eu-west-2，伦敦）。

## 数据库
- 迁移在 `supabase/migrations/0001…0006`，按顺序执行。线上没有用 Supabase CLI 管迁移：新迁移写成下一个编号的 SQL 文件提交进仓库，再让用户把 SQL 粘贴到 https://supabase.com/dashboard/project/hmekrexuepbkcckljdad/sql/new 执行（或者用 Supabase MCP 执行，需要用户确认）。
- 所有表都开了 RLS，只能访问自己的行。需要跨表保证一致性的操作写成 `security definer` 函数，通过 `sb.rpc()` 调用：
  `set_transaction_split`、`set_transaction_status`、`reset_transaction`、`create_invite`、`accept_invite`、`invite_info`、`shares_owed_by_me`、`counterpart_settlements`、`contact_balances`、`monthly_spend`、`ai_rate_check`（每人每分钟最多 10 次 AI 调用）。
- 触发器 `lock_split_transaction`：一笔账有 splits 时，不能直接改 `amount_pence` 或 `status`。要先 `reset_transaction`（清掉分账和小票，回到 pending），或者用 `set_transaction_split` 整体替换。
- 触发器 `protect_contact_link`：`linked_user_id` 只能通过 `accept_invite` 设置。
- `src/lib/db/types.ts` 的类型是手写的，改表结构时要同步更新。
- Storage 桶 `uploads` 是私有的，路径 `{userId}/statement|receipt/{uuid}.jpg`。

## 金额和正负号约定（改代码前必读）
- 金额一律用**整数便士**（`amount_pence`），只在显示和输入时用 `src/lib/money.ts` 转换。币种固定英镑。
- 交易 `amount_pence`：正数是支出，负数是收入或转入（`status = 'transfer'`）。
- `splits.contact_id = null` 表示「我」。一笔账所有 share 加起来必须正好等于 `amount_pence`（数据库会检查）。
- 平均分（`src/lib/split/equal.ts`）：除不尽的零头给我；我不参与时给第一个人。
- 按小票分（`src/lib/split/receipt.ts`）：每样商品在它的所有人之间平分；小票合计和银行扣款的差额，用最大余数法按比例分摊，或者全算我的。选的是哪种**没有存下来**。
- `settlements.amount_pence`：正数 = TA 转给我（我欠 TA 的增加 / TA 欠我的减少），负数 = 我转给 TA。`kind = 'opening'` 是起始欠款，正负号规则相同：「TA 欠我 £X」存成 `-X`。
- 余额（`src/lib/balance.ts`）：正数表示 TA 欠我。

## 代码结构
- `src/app/`：页面。`page.tsx` 面板、`bills/` 账单、`import/` 导入、`review/` 待处理（滑卡片）、`contacts/[id]/` 同学详情、`settings/`、`invite/[token]/`、`login`、`signup`、`forgot`、`reset-password`、`auth/callback`。
- `src/app/api/ai/{statement,receipt,categorize}/route.ts`：AI 接口，共用 `src/lib/ai/route-helpers.ts`（登录检查、校验、限流、把错误转成中文提示）。
- `src/lib/ai/`：`run.ts` 用 `client.beta.messages.parse` + zod 结构化输出；模型在 `models.ts`（默认 Sonnet 5.5，可选 Haiku 5.5 / Opus 5.5，界面上可以「用 Opus 重新识别」）。
- `src/lib/data/`：所有 Supabase 读写都放这里（bills、contacts、dashboard、import、receipt、review、settings），页面只调用这些函数。
- `src/lib/csv/`：CSV 解析器注册表。目前只有 HSBC（`hsbc.ts`，导出文件没有表头）。加新银行：在 `tests/fixtures/` 放一份脱敏样本，实现 `CsvParser`，再加进 `registry.ts` 的 `CSV_PARSERS`。
- `src/components/review/`：滑卡片（`SwipeDeck`、`TxCard`、`HandStrip`）、`SplitSheet`（选人和分法）、`ReceiptAssigner`（小票逐项分配）。`components/bills/EditSplit.tsx` 复用这两个组件来修改已有的分账。
- 测试：`tests/unit/*.test.ts`；`tests/unit/fake-supabase.ts` 是一个会记录调用的假 Supabase 客户端，数据层测试都用它。

## 写代码的习惯
- 界面文字全部中文，口语化（「TA 欠你」「两清」「去处理 ›」）。
- 以手机为准：最大宽度 480px，底部有导航栏，弹出层用底部抽屉（参考 `SplitSheet` / `BillSheet` 的写法和 z-index）。
- 改数据的按钮要防重复点击（`busy` 状态）；删除类操作要点两次确认。
- 改动后更新或新增 `tests/unit` 里的测试。
- 用户的真实 CSV 和截图里有账号、姓名，**不要提交未脱敏的真实数据**。

## 已知问题 / 待办
- 保存小票（`saveReceipt`）和保存分账（`set_transaction_split`）是两次独立请求，不是原子操作；小票被删除时，Storage 里的图片没有一起删。
- 按小票分时选的差额处理方式（按比例 / 算我的）没有保存，重新编辑时默认按比例。
- 已关联账号的同学在 TA 自己那边只看得到金额，看不到小票明细。
- 「待处理」里撤销会把卡片放回 pending，而不是恢复之前的状态。
- `MonthlySpend` 按 UTC 计算月份。
- Monzo、Lloyds、招商银行的 CSV 解析器还没做，等用户提供样本。
- Supabase 自带的邮件服务有频率限制，注册时可能报「email rate limit exceeded」；可以在 Auth 设置里关掉邮箱确认，或者配置自己的 SMTP。
- 设计文档：`docs/superpowers/specs/2026-10-25-split-ledger-design.md`；最初的实现计划：`docs/superpowers/plans/2026-10-25-split-ledger.md`。
