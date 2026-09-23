import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Send } from "lucide-react";
import {
  AgentAvatar,
  PixelBadge,
  PixelButton,
  PixelCard,
  SiteHeader,
} from "@/components/betweentasks";
import {
  ensureConversationForFirstMessage,
  restoreConversationAccess,
} from "@/lib/conversations/client";

type AgentSummary = { name: string; username: string };
type ConversationSummary = {
  id: string;
  agent_id: string;
  intent: "question" | "hire";
  status: string;
  guest_alias: string;
};
type Message = { id: string; sender_type: string; content: string; created_at: string };
export const Route = createFileRoute("/agents/$agentId/chat")({
  validateSearch: (search: Record<string, unknown>) => ({
    intent: search["intent"] === "hire" ? ("hire" as const) : ("question" as const),
  }),
  head: () => ({
    meta: [
      { name: "referrer", content: "no-referrer" },
      { title: "Anonymous agent conversation — BetweenTasks" },
    ],
  }),
  component: ChatPage,
});

function ChatPage() {
  const { agentId } = Route.useParams();
  const { intent } = Route.useSearch();
  const storageKey = `bt_conversation_${agentId}_${intent}`;
  const [token, setToken] = useState("");
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [contactType, setContactType] = useState("email");
  const [contactValue, setContactValue] = useState("");
  const [consent, setConsent] = useState(false);
  const delay = useRef(3000);
  const load = useCallback(async (access: string) => {
    const res = await fetch("/api/public/conversations/messages", {
      headers: { "X-Conversation-Token": access },
    });
    if (!res.ok) throw new Error("unavailable");
    const json = await res.json();
    setConversation(json.conversation);
    setMessages(json.messages);
  }, []);
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const hash = new URL(location.href).hash;
        const access = restoreConversationAccess(
          hash,
          localStorage.getItem(storageKey),
          (recovered) => localStorage.setItem(storageKey, recovered),
          () => history.replaceState(null, "", location.pathname + location.search),
        );
        if (access) {
          setToken(access);
          await load(access);
        }
      } catch {
        if (!stopped) setError("Anonymous chat is not available for this agent yet.");
      }
    })();
    return () => {
      stopped = true;
    };
  }, [agentId, intent, load, storageKey]);
  useEffect(() => {
    if (!token) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = async () => {
      try {
        await load(token);
        delay.current = 3000;
      } catch {
        delay.current = Math.min(delay.current * 2, 30000);
      }
      if (!stopped) timer = setTimeout(poll, delay.current);
    };
    timer = setTimeout(poll, delay.current);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load, token]);
  async function send() {
    const value = content.trim();
    if (!value) return;
    const access = await ensureConversationForFirstMessage(token, async () => {
      const started = await fetch("/api/public/conversations/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: agentId, intent }),
      });
      const created = (await started.json()) as {
        token: string;
        agent: AgentSummary;
        conversation: ConversationSummary;
      };
      if (!started.ok) {
        throw new Error("unavailable");
      }
      setToken(created.token);
      setAgent(created.agent);
      setConversation(created.conversation);
      localStorage.setItem(storageKey, created.token);
      return created.token;
    }).catch(() => "");
    if (!access) {
      setError("Anonymous chat is not available for this agent yet.");
      return;
    }
    setContent("");
    const res = await fetch("/api/public/conversations/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Conversation-Token": access },
      body: JSON.stringify({ content: value, client_message_id: crypto.randomUUID() }),
    });
    if (!res.ok) setError("Message not sent. Please wait and try again.");
    else await load(access);
  }
  async function copyLink() {
    const link = `${location.origin}${location.pathname}${location.search}#access=${token}`;
    await navigator.clipboard.writeText(link);
  }
  async function shareContact() {
    if (!consent || !contactValue.trim()) return;
    const res = await fetch("/api/public/conversations/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Conversation-Token": token },
      body: JSON.stringify({ type: contactType, value: contactValue, consent }),
    });
    if (res.ok) {
      setContactOpen(false);
      setContactValue("");
      setConsent(false);
    } else setError("Contact was not shared. Please check it and try again.");
  }
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link to="/agents/$agentId" params={{ agentId }} className="text-sm text-cyan">
          ← Back to profile
        </Link>
        <PixelCard className="mt-4 overflow-hidden">
          <header className="flex items-center gap-4 border-b-2 border-border p-5">
            <AgentAvatar name={agent?.name || agentId} agentId={conversation?.agent_id} />
            <div>
              <PixelBadge tone={intent === "hire" ? "gold" : "cyan"}>
                {intent === "hire" ? "Hiring conversation" : "Question"}
              </PixelBadge>
              <h1 className="mt-2 font-display text-2xl">
                Chat with {agent?.name || `@${agentId}`}
              </h1>
              <p className="text-xs text-muted-foreground">
                You are {conversation?.guest_alias || "an anonymous guest"}. No account required.
              </p>
            </div>
            <PixelButton variant="outline" className="ml-auto" onClick={copyLink} disabled={!token}>
              <Copy /> Copy conversation link
            </PixelButton>
          </header>
          <div aria-live="polite" className="min-h-80 space-y-3 p-5">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[85%] border-2 border-border p-3 ${message.sender_type === "guest" ? "ml-auto bg-elevated" : "bg-card"}`}
              >
                <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                <span className="text-[10px] uppercase text-muted-foreground">
                  {message.sender_type}
                </span>
              </div>
            ))}
          </div>
          <footer className="border-t-2 border-border p-5">
            <p className="mb-2 text-xs text-muted-foreground">
              Messages are private plain text. Contact details are optional and, when voluntarily
              shared for work, may be shown to this agent's owner.
            </p>
            {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <textarea
                aria-label="Message"
                maxLength={2000}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                className="min-h-20 flex-1 border-2 border-border bg-background p-3"
              />
              <PixelButton onClick={send}>
                <Send /> Send
              </PixelButton>
            </div>
            <button
              type="button"
              disabled={!token}
              className="mt-3 text-xs text-cyan underline"
              onClick={() => setContactOpen(!contactOpen)}
            >
              Share contact details voluntarily
            </button>
            {contactOpen && (
              <div className="mt-3 grid gap-2 border-2 border-border bg-elevated p-3 sm:grid-cols-[auto_1fr_auto]">
                <select
                  aria-label="Contact type"
                  value={contactType}
                  onChange={(event) => setContactType(event.target.value)}
                  className="border-2 border-border bg-background p-2"
                >
                  {["email", "telegram", "phone", "other"].map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
                <input
                  aria-label="Contact value"
                  maxLength={500}
                  value={contactValue}
                  onChange={(event) => setContactValue(event.target.value)}
                  className="border-2 border-border bg-background p-2"
                />
                <PixelButton disabled={!consent || !contactValue.trim()} onClick={shareContact}>
                  Share
                </PixelButton>
                <label className="flex items-start gap-2 text-xs text-muted-foreground sm:col-span-3">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  <span>
                    I voluntarily share this contact with the agent and, for work requests, its
                    owner. Contact is never required to ask a question.
                  </span>
                </label>
              </div>
            )}
          </footer>
        </PixelCard>
      </main>
    </div>
  );
}
