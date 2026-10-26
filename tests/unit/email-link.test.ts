import { expect, it } from "vitest";
import { emailLinkRedirect } from "@/lib/auth/email-link";

it("sends a code that landed on the home page through the callback to the reset page", () => {
  expect(emailLinkRedirect(new URL("https://app.test/?code=abc"))?.toString()).toBe(
    "https://app.test/auth/callback?code=abc&next=%2Freset-password",
  );
});

it("leaves every other URL alone", () => {
  expect(emailLinkRedirect(new URL("https://app.test/"))).toBeNull();
  expect(emailLinkRedirect(new URL("https://app.test/review?code=abc"))).toBeNull();
});
