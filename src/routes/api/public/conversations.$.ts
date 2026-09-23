/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";

const headers = {
  "Content-Type": "application/json",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const unavailable = () =>
  response(
    { success: false, error: "conversation_unavailable", message: "Conversation unavailable." },
    404,
  );

export const Route = createFileRoute("/api/public/conversations/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, String(params._splat ?? ""), "GET"),
      POST: ({ request, params }) => handle(request, String(params._splat ?? ""), "POST"),
      OPTIONS: () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Headers": "Content-Type, X-Conversation-Token",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          },
        }),
    },
  },
});

async function handle(request: Request, splat: string, method: "GET" | "POST") {
  const { createConversation, listGuestMessages, privacySubject, sendGuestMessage, submitContact } =
    await import("@/lib/conversations/server");
  const { MAX_REQUEST_BYTES, readBoundedJson } = await import("@/lib/conversations/security");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const parts = splat.split("/").filter(Boolean);
  const token = request.headers.get("x-conversation-token") ?? "";
  try {
    if (method === "POST" && parts[0] === "start") {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > MAX_REQUEST_BYTES)
        return response({ success: false, error: "payload_too_large" }, 413);
      const body = JSON.parse(raw || "{}") as Record<string, unknown>;
      const username = typeof body["username"] === "string" ? body["username"] : "";
      const intent =
        body["intent"] === "hire" ? "hire" : body["intent"] === "question" ? "question" : null;
      if (!username || !intent)
        return response({ success: false, error: "validation_failed" }, 400);
      const { data: agent } = await (supabaseAdmin as any)
        .from("agents")
        .select("id,name,username,avatar_url,status")
        .eq("username", username)
        .eq("status", "active")
        .maybeSingle();
      if (!agent) return unavailable();
      const created = await createConversation(agent.id, intent, await privacySubject(request));
      return created ? response({ success: true, ...created, agent }, 201) : unavailable();
    }
    if (method === "GET" && parts[0] === "messages") {
      const url = new URL(request.url);
      const page = boundedInt(url.searchParams.get("page"), 1, 10_000, 1);
      const pageSize = boundedInt(url.searchParams.get("page_size"), 1, 100, 50);
      const result = await listGuestMessages(token, page, pageSize);
      return result ? response({ success: true, ...result }) : unavailable();
    }
    if (method === "POST" && parts[0] === "messages") {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > MAX_REQUEST_BYTES)
        return response({ success: false, error: "payload_too_large" }, 413);
      const body = JSON.parse(raw || "{}") as Record<string, unknown>;
      const result = await sendGuestMessage(
        token,
        body["content"],
        typeof body["client_message_id"] === "string" ? body["client_message_id"] : undefined,
      );
      return result ? response({ success: true, message: result }, 201) : unavailable();
    }
    if (method === "POST" && parts[0] === "contact") {
      const parsed = await readBoundedJson(request, MAX_REQUEST_BYTES);
      if (!parsed.ok)
        return response(
          { success: false, error: parsed.tooLarge ? "payload_too_large" : "validation_failed" },
          parsed.tooLarge ? 413 : 400,
        );
      const body = parsed.value;
      const result = await submitContact(token, {
        type: body["type"],
        value: body["value"],
        consent: body["consent"],
      });
      return result ? response(result, 201) : unavailable();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "rate_limited")
      return response(
        { success: false, error: "rate_limited", message: "Please wait and try again." },
        429,
      );
    if (message.startsWith("validation:"))
      return response(
        { success: false, error: "validation_failed", message: message.slice(11) },
        400,
      );
    return response(
      { success: false, error: "request_failed", message: "The request could not be completed." },
      400,
    );
  }
  return unavailable();
}

function boundedInt(value: string | null, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum ? Math.min(number, maximum) : fallback;
}
