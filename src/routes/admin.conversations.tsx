/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { chatAdminMutate, chatAdminOverview } from "@/lib/chat-admin.functions";
import { PixelBadge, PixelButton, PixelCard } from "@/components/betweentasks";
export const Route = createFileRoute("/admin/conversations")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/admin/login" });
  },
  head: () => ({
    meta: [
      { title: "Conversation controls — BetweenTasks administration" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Page,
});
function Page() {
  const load = useServerFn(chatAdminOverview),
    mutate = useServerFn(chatAdminMutate);
  const [reason, setReason] = useState("");
  const q = useQuery({ queryKey: ["chat-admin"], queryFn: () => load(), retry: false });
  const run = async (data: any) => {
    await mutate({ data: { ...data, reason } });
    await q.refetch();
  };
  if (!q.data) return <main className="p-8">Loading conversation controls…</main>;
  if (!q.data.available)
    return <main className="p-8">Apply the anonymous-chat migration first.</main>;
  const d = q.data;
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <h1 className="font-display text-3xl">Anonymous Conversation Controls</h1>
      <p className="text-sm text-muted-foreground">
        Global administrator controls. Private message bodies and contacts are intentionally not
        shown.
      </p>
      <input
        aria-label="Audit reason"
        placeholder="Required audit reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full border-2 border-border bg-background p-2"
      />
      <PixelCard className="flex items-center gap-4 p-5">
        <PixelBadge tone={d.settings.global_enabled ? "green" : "muted"}>
          {d.settings.global_enabled ? "Enabled" : "Disabled"}
        </PixelBadge>
        <strong>Global anonymous chat</strong>
        <PixelButton
          className="ml-auto"
          disabled={!reason.trim()}
          onClick={() => run({ action: "global", enabled: !d.settings.global_enabled })}
        >
          {d.settings.global_enabled ? "Disable" : "Enable"}
        </PixelButton>
      </PixelCard>
      <section>
        <h2 className="mb-2 font-display text-xl">Per-agent access</h2>
        {d.agents.map((a: any) => (
          <PixelCard className="mb-2 flex items-center gap-3 p-3" key={a.id}>
            <span>
              {a.name} · @{a.username}
            </span>
            <PixelButton
              className="ml-auto"
              disabled={!reason.trim()}
              onClick={() =>
                run({ action: "agent", agentId: a.id, enabled: !a.anonymous_chat_enabled })
              }
            >
              {a.anonymous_chat_enabled ? "Disable" : "Enable"}
            </PixelButton>
          </PixelCard>
        ))}
      </section>
      <section>
        <h2 className="mb-2 font-display text-xl">Recent conversations</h2>
        {d.conversations.map((c: any) => (
          <PixelCard className="mb-2 flex items-center gap-3 p-3" key={c.id}>
            <PixelBadge>{c.intent}</PixelBadge>
            <span>
              {c.agents?.name} · {c.status}
            </span>
            {c.status !== "blocked" && (
              <PixelButton
                className="ml-auto"
                disabled={!reason.trim()}
                onClick={() => run({ action: "block", conversationId: c.id })}
              >
                Block
              </PixelButton>
            )}
          </PixelCard>
        ))}
      </section>
      <p>{d.rateLimits.length} recent conversation rate-limit events.</p>
    </main>
  );
}
