import { AiError } from "@/lib/ai/errors";
import { categorizePrompt } from "@/lib/ai/prompts";
import { withAi } from "@/lib/ai/route-helpers";
import { runStructured } from "@/lib/ai/run";
import { CategorizeOutput } from "@/lib/ai/schemas";
import { formatPence } from "@/lib/money";

type Item = { merchant: string; amountPence: number };

function validate(body: Record<string, unknown>): Item[] | null {
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) return null;
  const ok = items.every(
    (i) => i && typeof i.merchant === "string" && Number.isInteger(i.amountPence),
  );
  return ok ? (items as Item[]) : null;
}

export async function POST(req: Request) {
  return withAi(req, "categorize", validate, async ({ model }, items) => {
    const lines = items.map((i, n) => `${n + 1}. ${i.merchant} ${formatPence(i.amountPence)}`).join("\n");
    const r = await runStructured({
      model,
      system: categorizePrompt(),
      content: [{ type: "text", text: lines }],
      schema: CategorizeOutput,
      mockKey: "categorize",
      mockCount: items.length,
    });
    if (r.categories.length !== items.length) throw new AiError("invalid_output");
    return { categories: r.categories };
  });
}
