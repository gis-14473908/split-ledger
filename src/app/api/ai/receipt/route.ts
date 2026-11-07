import { RECEIPT_PROMPT } from "@/lib/ai/prompts";
import { downloadImage, ownImagePath, withAi } from "@/lib/ai/route-helpers";
import { runStructured } from "@/lib/ai/run";
import { ReceiptOutput } from "@/lib/ai/schemas";
import { poundsToPence } from "@/lib/money";

export const maxDuration = 60;

export async function POST(req: Request) {
  return withAi(req, "receipt", ownImagePath, async ({ sb, source }, imagePath) => {
    const image = await downloadImage(sb, imagePath);
    const { parsed: r, usage } = await runStructured({
      source,
      system: RECEIPT_PROMPT,
      content: [image, { type: "text", text: "列出这张小票上的所有商品。" }],
      schema: ReceiptOutput,
      mockKey: "receipt",
    });
    return {
      json: {
        source: source.label,
        merchant: r.merchant,
        items: r.items.map((i) => ({ name: i.name, pricePence: poundsToPence(i.price) })),
        totalPence: poundsToPence(r.total),
      },
      usage,
    };
  });
}
