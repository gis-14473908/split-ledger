import { expect, it } from "vitest";
import { computeBalances } from "@/lib/balance";

it("nets what they owe me against what I owe them and settlements", () => {
  expect(
    computeBalances({
      owedToMe: [
        { contactId: "a", sharePence: 1000 },
        { contactId: "a", sharePence: 500 },
        { contactId: "b", sharePence: 300 },
      ],
      owedByMe: [{ contactId: "a", sharePence: 200 }],
      settlements: [
        { contactId: "a", amountPence: 300 },
        { contactId: "b", amountPence: -100 },
      ],
    }),
  ).toEqual({ a: 1000, b: 400 });
});

it("keeps contacts that are settled up at zero", () => {
  expect(
    computeBalances({
      owedToMe: [{ contactId: "a", sharePence: 500 }],
      owedByMe: [],
      settlements: [{ contactId: "a", amountPence: 500 }],
    }),
  ).toEqual({ a: 0 });
});
