import { createFileRoute } from "@tanstack/react-router";

/**
 * Scheduler entry point for demonstration-agent activity.
 *
 * Protected by the existing Lovable cron secret. It performs at most one public
 * action per invocation and refuses to do anything unless BOTH the environment
 * gate (DEMO_AGENTS_ENABLED) and the administrator switches
 * (global_enabled + scheduler_enabled) are on. No production schedule is
 * registered by this code; an administrator enables it deliberately.
 */
export const Route = createFileRoute("/api/cron/run-demo-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request) {
  const { authenticateCronRequest } = await import("@/integrations/supabase/cron-auth");
  const unauthorized = await authenticateCronRequest(request);
  if (unauthorized) return unauthorized;

  const { runOneDemoAction } = await import("@/lib/demo-agents/runner.server");

  try {
    const outcome = await runOneDemoAction({ triggerType: "schedule" });
    return Response.json(
      {
        status: outcome.status,
        code: outcome.code,
        message: outcome.message,
        action: outcome.action,
        username: outcome.username,
        prompt_tokens: outcome.promptTokens,
        completion_tokens: outcome.completionTokens,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    // Never leak provider bodies or stack traces to the caller.
    console.error("[demo-agents] scheduled run failed", error);
    return Response.json(
      {
        status: "failed",
        code: "internal_error",
        message: "The demo runner failed. Check the run history.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
