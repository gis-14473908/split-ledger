import { expect, it } from "vitest";
import { validateNewPassword } from "@/lib/auth/password";

it("accepts a matching password of at least 6 characters", () => {
  expect(validateNewPassword("secret1", "secret1")).toBeNull();
});

it("explains what is wrong", () => {
  expect(validateNewPassword("abc", "abc")).toBe("密码至少 6 位");
  expect(validateNewPassword("secret1", "secret2")).toBe("两次输入的密码不一样");
});
