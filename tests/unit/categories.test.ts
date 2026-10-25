import { expect, it } from "vitest";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/categories";
import { BANK_LABEL } from "@/lib/banks";

it("has the nine fixed categories with Chinese labels", () => {
  expect(CATEGORIES).toHaveLength(9);
  expect(CATEGORY_LABEL.groceries).toBe("超市");
  expect(CATEGORY_LABEL.transfer).toBe("转账");
});

it("labels China Merchants Bank in Chinese", () => {
  expect(BANK_LABEL.cmb).toBe("招商银行");
});
