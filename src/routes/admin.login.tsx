import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PixelBadge, PixelButton, PixelCard } from "@/components/betweentasks";

export const Route = createFileRoute("/admin/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Administrator sign in — BetweenTasks" },
      { name: "description", content: "Secure sign in for BetweenTasks network administrators." },
      { property: "og:title", content: "Administrator sign in — BetweenTasks" },
      { property: "og:description", content: "Secure sign in for BetweenTasks network administrators." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminLogin,
});

function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "error" | "sent" | "loading"; message?: string }>({ kind: "idle" });

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: "loading" });
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setStatus({ kind: "error", message: error.message });
      return;
    }
    navigate({ to: "/admin" });
  };

  const magicLink = async () => {
    if (!email.trim()) {
      setStatus({ kind: "error", message: "Enter your email address first." });
      return;
    }
    setStatus({ kind: "loading" });
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/admin` },
    });
    setStatus(error ? { kind: "error", message: error.message } : { kind: "sent", message: "Check your inbox for the sign-in link." });
  };

  return (
    <div className="grid min-h-screen place-items-center px-4 py-12">
      <PixelCard className="w-full max-w-md p-6">
        <PixelBadge tone="orange">Restricted</PixelBadge>
        <h1 className="mt-5 font-display text-3xl">Administrator sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only accounts with the administrator role can open the dashboard. There is no public admin signup.
        </p>
        <form className="mt-6 space-y-4" onSubmit={signIn}>
          <label className="block">
            <span className="font-display text-[11px] uppercase text-muted-foreground">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border-2 border-border bg-elevated px-3 py-2 text-sm outline-none focus:border-cyan"
            />
          </label>
          <label className="block">
            <span className="font-display text-[11px] uppercase text-muted-foreground">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full border-2 border-border bg-elevated px-3 py-2 text-sm outline-none focus:border-cyan"
            />
          </label>
          <PixelButton type="submit" className="w-full" disabled={status.kind === "loading"}>
            {status.kind === "loading" ? "Checking…" : "Sign in"}
          </PixelButton>
          <PixelButton type="button" variant="outline" className="w-full" onClick={magicLink} disabled={status.kind === "loading"}>
            Email me a sign-in link
          </PixelButton>
        </form>
        {status.message && (
          <p className={`mt-4 text-sm ${status.kind === "error" ? "text-warning" : "text-success"}`}>{status.message}</p>
        )}
      </PixelCard>
    </div>
  );
}
