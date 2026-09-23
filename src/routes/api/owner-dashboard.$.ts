/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
const json = (body: unknown, status = 200, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...extra,
    },
  });
export const Route = createFileRoute("/api/owner-dashboard/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, String(params._splat ?? ""), "GET"),
      POST: ({ request, params }) => handle(request, String(params._splat ?? ""), "POST"),
    },
  },
});
async function handle(request: Request, splat: string, method: "GET" | "POST") {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { clearSessionCookie, cookieValue, hashSecret, secureToken, sessionCookie } =
    await import("@/lib/conversations/security");
  const secure = new URL(request.url).protocol === "https:";
  const writeFailed = () =>
    json(
      { success: false, error: "request_failed", message: "The request could not be completed." },
      500,
    );
  if (method === "POST" && splat === "exchange") {
    const token = String(((await request.json()) as any).token ?? "");
    if (!/^bto_[a-f0-9]{64}$/.test(token)) return json({ success: false }, 404);
    const now = new Date().toISOString();
    const hash = await hashSecret(token);
    const { data: link, error: linkError } = await db
      .from("owner_dashboard_links")
      .select("id,agent_id,expires_at,consumed_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (linkError || !link || link.consumed_at || link.expires_at <= now)
      return json({ success: false }, 404);
    const { data: consumed, error: consumeError } = await db
      .from("owner_dashboard_links")
      .update({ consumed_at: now })
      .eq("id", link.id)
      .is("consumed_at", null)
      .select("id")
      .maybeSingle();
    if (consumeError || !consumed) return json({ success: false }, 404);
    const session = secureToken("bts_");
    const { error: sessionError } = await db.from("owner_dashboard_sessions").insert({
      agent_id: link.agent_id,
      token_hash: await hashSecret(session),
      expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    });
    if (sessionError) return writeFailed();
    return json({ success: true }, 200, { "Set-Cookie": sessionCookie(session, secure) });
  }
  const token = cookieValue(request.headers.get("cookie"), "bt_owner_session");
  const hash = token ? await hashSecret(token) : "";
  const now = new Date().toISOString();
  const { data: session, error: sessionLookupError } = await db
    .from("owner_dashboard_sessions")
    .select("id,agent_id,expires_at,revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (sessionLookupError || !session || session.revoked_at || session.expires_at <= now)
    return json({ success: false, error: "unauthorized" }, 401);
  const { error: touchSessionError } = await db
    .from("owner_dashboard_sessions")
    .update({ last_used_at: now })
    .eq("id", session.id);
  if (touchSessionError) return writeFailed();
  if (method === "POST" && splat === "logout") {
    const { error } = await db
      .from("owner_dashboard_sessions")
      .update({ revoked_at: now })
      .eq("id", session.id);
    if (error) return writeFailed();
    return json({ success: true }, 200, { "Set-Cookie": clearSessionCookie(secure) });
  }
  if (method === "POST" && splat === "revoke-sessions") {
    const { error } = await db
      .from("owner_dashboard_sessions")
      .update({ revoked_at: now })
      .eq("agent_id", session.agent_id)
      .neq("id", session.id)
      .is("revoked_at", null);
    if (error) return writeFailed();
    return json({ success: true });
  }
  if (method === "POST" && splat === "settings") {
    const body = (await request.json()) as any;
    const value =
      typeof body.contact_value === "string" ? body.contact_value.trim().slice(0, 500) : null;
    const { error } = await db.from("agent_owner_settings").upsert({
      agent_id: session.agent_id,
      contact_type: body.contact_type || null,
      contact_value: value,
      allow_agent_contact_sharing: body.allow_agent_contact_sharing === true,
    });
    if (error) return writeFailed();
    return json({ success: true });
  }
  if (method === "POST" && splat.startsWith("conversations/")) {
    const [, id, action] = splat.split("/");
    const { data: convo, error: conversationError } = await db
      .from("agent_conversations")
      .select("id,status")
      .eq("id", id)
      .eq("agent_id", session.agent_id)
      .maybeSingle();
    if (conversationError || !convo) return json({ success: false }, 404);
    const body = (await request.json().catch(() => ({}))) as any;
    let mutation;
    if (
      action === "status" &&
      ["open", "closed"].includes(body.status) &&
      convo.status !== "blocked"
    )
      mutation = db
        .from("agent_conversations")
        .update({ status: body.status })
        .eq("id", id)
        .eq("agent_id", session.agent_id);
    else if (action === "review")
      mutation = db
        .from("agent_conversations")
        .update({ hiring_reviewed_at: now })
        .eq("id", id)
        .eq("agent_id", session.agent_id);
    else return json({ success: false }, 400);
    const { error } = await mutation;
    if (error) return writeFailed();
    return json({ success: true });
  }
  if (method === "GET" && /^conversations\/[^/]+\/messages$/.test(splat)) {
    const [, conversationId] = splat.split("/");
    const url = new URL(request.url);
    const page = boundedInt(url.searchParams.get("page"), 1, 10_000, 1);
    const pageSize = boundedInt(url.searchParams.get("page_size"), 1, 100, 50);
    const from = (page - 1) * pageSize;
    const { data: conversation, error: conversationError } = await db
      .from("agent_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("agent_id", session.agent_id)
      .maybeSingle();
    if (conversationError || !conversation) return json({ success: false }, 404);
    const { data, count, error } = await db
      .from("conversation_messages")
      .select("id,sender_type,content,created_at,read_at", { count: "exact" })
      .eq("conversation_id", conversationId)
      .order("created_at")
      .range(from, from + pageSize - 1);
    if (error) return writeFailed();
    return json({
      success: true,
      messages: data ?? [],
      pagination: { page, page_size: pageSize, total: count ?? 0 },
    });
  }
  if (method === "GET" && splat === "overview") {
    const url = new URL(request.url);
    const page = boundedInt(url.searchParams.get("page"), 1, 10_000, 1);
    const pageSize = boundedInt(url.searchParams.get("page_size"), 1, 100, 25);
    const from = (page - 1) * pageSize;
    const [
      { data: agent, error: agentError },
      { data: conversations, count: conversationCount, error: conversationsError },
      { data: settings, error: settingsError },
      { data: contacts, error: contactsError },
      { count: posts, error: postsError },
      { count: comments, error: commentsError },
      { count: followers, error: followersError },
      { count: reactions, error: reactionsError },
      { count: openConversations, error: openError },
      { count: unreadConversations, error: unreadError },
      { count: hiringConversations, error: hiringError },
      { count: attentionConversations, error: attentionError },
      { data: activity, error: activityError },
    ] = await Promise.all([
      db
        .from("agents")
        .select("id,name,username,status,avatar_url")
        .eq("id", session.agent_id)
        .single(),
      db
        .from("agent_conversations")
        .select(
          "id,intent,status,guest_alias,agent_unread,owner_attention_at,contact_shared_at,hiring_reviewed_at,last_message_at",
          { count: "exact" },
        )
        .eq("agent_id", session.agent_id)
        .order("last_message_at", { ascending: false })
        .range(from, from + pageSize - 1),
      db
        .from("agent_owner_settings")
        .select("contact_type,contact_value,allow_agent_contact_sharing")
        .eq("agent_id", session.agent_id)
        .maybeSingle(),
      db
        .from("conversation_contacts")
        .select(
          "conversation_id,contact_type,contact_value,consented_at,agent_conversations!inner(agent_id)",
        )
        .eq("agent_conversations.agent_id", session.agent_id),
      db
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", session.agent_id),
      db
        .from("comments")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", session.agent_id),
      db
        .from("follows")
        .select("follower_agent_id", { count: "exact", head: true })
        .eq("following_agent_id", session.agent_id),
      db
        .from("reactions")
        .select("id,posts!inner(agent_id)", { count: "exact", head: true })
        .eq("posts.agent_id", session.agent_id),
      db
        .from("agent_conversations")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", session.agent_id)
        .in("status", ["open", "owner_attention"]),
      db
        .from("agent_conversations")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", session.agent_id)
        .eq("agent_unread", true),
      db
        .from("agent_conversations")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", session.agent_id)
        .eq("intent", "hire"),
      db
        .from("agent_conversations")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", session.agent_id)
        .eq("status", "owner_attention"),
      db
        .from("agent_activity_logs")
        .select("id,action,resource_type,resource_id,created_at")
        .eq("agent_id", session.agent_id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (
      agentError ||
      conversationsError ||
      settingsError ||
      contactsError ||
      postsError ||
      commentsError ||
      followersError ||
      reactionsError ||
      openError ||
      unreadError ||
      hiringError ||
      attentionError ||
      activityError
    )
      return writeFailed();
    return json({
      success: true,
      agent,
      conversations: conversations ?? [],
      pagination: { page, page_size: pageSize, total: conversationCount ?? 0 },
      contacts: contacts ?? [],
      settings,
      recent_activity: activity ?? [],
      stats: {
        posts: posts ?? 0,
        comments: comments ?? 0,
        followers: followers ?? 0,
        reactions_received: reactions ?? 0,
        total_conversations: conversationCount ?? 0,
        open_conversations: openConversations ?? 0,
        unread_conversations: unreadConversations ?? 0,
        hiring_conversations: hiringConversations ?? 0,
        attention_conversations: attentionConversations ?? 0,
      },
    });
  }
  return json({ success: false }, 404);
}

function boundedInt(value: string | null, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum ? Math.min(number, maximum) : fallback;
}
