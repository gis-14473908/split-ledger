import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "../supabase/server";
import { AI_ERROR_MESSAGE, AI_ERROR_STATUS, AiError } from "./errors";
import { isModelKey, type ModelKey } from "./models";

export type AiContext = { sb: SupabaseClient; userId: string; model: ModelKey };

type Body = Record<string, unknown>;

/**
 * Shared shell for the AI endpoints: sign-in, request validation, API key,
 * per-user rate limit, then the call itself, with errors mapped to Chinese messages.
 */
export async function withAi<I>(
  req: Request,
  kind: string,
  validate: (body: Body, userId: string) => I | null,
  run: (ctx: AiContext, input: I) => Promise<unknown>,
): Promise<Response> {
  try {
    const sb = (await createServerSupabase()) as unknown as SupabaseClient;
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) throw new AiError("unauthorized");

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      throw new AiError("bad_request");
    }
    const input = validate(body ?? {}, user.id);
    if (input === null) throw new AiError("bad_request");

    if (!process.env.ANTHROPIC_API_KEY && process.env.AI_MOCK !== "1") throw new AiError("no_key");

    let model: ModelKey;
    if (isModelKey(body.model)) {
      model = body.model;
    } else {
      const { data } = await sb.from("profiles").select("default_model").eq("id", user.id).single();
      model = isModelKey(data?.default_model) ? data.default_model : "sonnet";
    }

    const { error } = await sb.rpc("ai_rate_check", { p_kind: kind, p_model: model });
    if (error) throw new AiError(error.message.includes("rate_limited") ? "rate_limited" : "upstream");

    return Response.json(await run({ sb, userId: user.id, model }, input));
  } catch (e) {
    if (e instanceof AiError) {
      return Response.json({ error: AI_ERROR_MESSAGE[e.code] }, { status: AI_ERROR_STATUS[e.code] });
    }
    console.error("AI route failed", e);
    return Response.json({ error: AI_ERROR_MESSAGE.upstream }, { status: 502 });
  }
}

/** Accepts only a path inside the caller's own folder of the uploads bucket. */
export function ownImagePath(body: Body, userId: string): string | null {
  const p = body.imagePath;
  return typeof p === "string" && p.startsWith(`${userId}/`) && !p.includes("..") ? p : null;
}

export async function downloadImage(sb: SupabaseClient, path: string) {
  const { data, error } = await sb.storage.from("uploads").download(path);
  if (error || !data) throw new AiError("bad_request");
  const mediaType = ["image/png", "image/webp", "image/gif"].includes(data.type) ? data.type : "image/jpeg";
  return {
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
      data: Buffer.from(await data.arrayBuffer()).toString("base64"),
    },
  };
}
