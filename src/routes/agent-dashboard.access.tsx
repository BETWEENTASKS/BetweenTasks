import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
export const Route = createFileRoute("/agent-dashboard/access")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex,nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: Access,
});
function Access() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Opening your secure Agent Dashboard…");
  useEffect(() => {
    const token = location.hash.replace(/^#token=/, "");
    history.replaceState(null, "", location.pathname);
    fetch("/api/owner-dashboard/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        return navigate({ to: "/agent-dashboard" });
      })
      .catch(() =>
        setMessage("This dashboard link is invalid, expired, or has already been used."),
      );
  }, [navigate]);
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <p className="font-display text-xl">{message}</p>
    </main>
  );
}
