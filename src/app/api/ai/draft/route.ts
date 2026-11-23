import { after } from "next/server";
import { runDraftJob } from "@/lib/ai/draft-job";
import { AiError } from "@/lib/ai/errors";
import { withAi } from "@/lib/ai/route-helpers";
import { MODEL_IDS, MODEL_KEYS } from "@/lib/ai/models";
import { costMicro } from "@/lib/ai/sources";

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Starts recognising a draft and returns at once; the work carries on after the response,
 * so leaving the page does not stop it. The result is written onto the draft row.
 */
export async function POST(req: Request) {
  return withAi(
    req,
    "draft",
    (body) => (typeof body.draftId === "string" && UUID.test(body.draftId) ? body.draftId : null),
    async ({ sb, userId, source }, draftId) => {
      const { data: draft } = await sb
        .from("import_drafts")
        .select("id, kind, image_path, status")
        .eq("id", draftId)
        .eq("owner_id", userId)
        .single();
      if (!draft || !draft.image_path || !draft.image_path.startsWith(`${userId}/`) || draft.kind === "csv") {
        throw new AiError("bad_request");
      }
      await sb.from("import_drafts").update({ status: "working", error: null }).eq("id", draft.id);

      // withAi bills the free quota from the response, which here is empty; bill when the job ends.
      const tier = MODEL_KEYS.find((k) => MODEL_IDS[k] === source.model);
      const onUsage = async (usage: { inputTokens: number; outputTokens: number }) => {
        if (source.kind !== "builtin" || !tier) return;
        const { error } = await sb.rpc("ai_quota_add", { p_micro: costMicro(tier, usage) });
        if (error) console.error("ai_quota_add failed", error);
      };
      after(() => runDraftJob(sb, { id: draft.id, kind: draft.kind, image_path: draft.image_path }, source, onUsage));
      return { json: { accepted: true }, usage: { inputTokens: 0, outputTokens: 0 } };
    },
  );
}
