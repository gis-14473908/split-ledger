import { AiError } from "@/lib/ai/errors";
import { statementPrompt } from "@/lib/ai/prompts";
import { downloadImage, ownImagePath, withAi } from "@/lib/ai/route-helpers";
import { runStructured } from "@/lib/ai/run";
import { StatementOutput, StatementResult, toParsedTransactions } from "@/lib/ai/schemas";

export const maxDuration = 60;

export async function POST(req: Request) {
  return withAi(req, "statement", ownImagePath, async ({ sb, model }, imagePath) => {
    const image = await downloadImage(sb, imagePath);
    const raw = await runStructured({
      model,
      system: statementPrompt(new Date().toISOString().slice(0, 10)),
      content: [image, { type: "text", text: "列出这张截图里的所有交易。" }],
      schema: StatementOutput,
      mockKey: "statement",
    });
    const checked = StatementResult.safeParse(raw);
    if (!checked.success) throw new AiError("invalid_output");
    return { model, transactions: toParsedTransactions(checked.data) };
  });
}
