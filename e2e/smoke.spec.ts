// End-to-end smoke test against a real Supabase project.
// Prereqs: the app runs with AI_MOCK=1 at E2E_BASE_URL, e2e/seed-users.sql has been applied,
// E2E_PASSWORD is set, and e2e/cleanup.sql has been run since the last pass.
import { expect, test, type Page } from "@playwright/test";

const A = "e2e-a@split-ledger.test";
const B = "e2e-b@split-ledger.test";
const PASSWORD = process.env.E2E_PASSWORD!;

async function login(page: Page, email: string, next = "/") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click('button:has-text("登录")');
  await page.waitForURL((u) => u.pathname === next.split("?")[0]);
}

test("import, swipe, split, invite, and see the debt from both sides", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await login(a, A, "/import");

  // The mock statement returns Pret £6.80, Tesco £23.45 and Nando's £48.60.
  await a.setInputFiles("#pick-images", { name: "statement.png", mimeType: "image/png", buffer: PNG });
  await expect(a.getByText("识别结果（3 笔）")).toBeVisible({ timeout: 30_000 });
  await a.click('button:has-text("导入 3 笔")');
  await a.click('text=去逐笔确认');

  await expect(a.getByText("剩 3 / 3 笔")).toBeVisible();
  await a.click('button:has-text("自己")'); // Pret
  await expect(a.getByText("剩 2 / 3 笔")).toBeVisible();

  await a.click('button:has-text("一起")'); // Tesco
  await a.click("text=+ 写个新名字");
  await a.fill("#new-contact", "测试同学");
  await a.click('role=dialog >> button:has-text("添加")');
  await expect(a.getByRole("dialog").getByText("测试同学 欠你 £11.72")).toBeVisible();
  await a.click("text=确认分账");
  await expect(a.getByText("剩 1 / 3 笔")).toBeVisible();

  await a.click('button:has-text("稍后")'); // Nando's
  await a.goto("/");
  const row = a.locator("li", { hasText: "测试同学" });
  await expect(row.getByText("£11.72")).toBeVisible();

  await row.click();
  await a.click("text=邀请 TA 注册");
  const link = await a.inputValue("#invite-link");

  const b = await (await browser.newContext()).newPage();
  await login(b, B, new URL(link).pathname);
  await b.click("text=确认关联");
  await expect(b.getByText("关联成功")).toBeVisible();
  await b.click("text=去看面板");
  const back = b.locator("li", { hasText: "测试阿明" });
  await expect(back.getByText("你欠 TA")).toBeVisible();
  await expect(back.getByText("£11.72")).toBeVisible();
});

// 1x1 PNG; the content doesn't matter because AI_MOCK answers the recognition call.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
