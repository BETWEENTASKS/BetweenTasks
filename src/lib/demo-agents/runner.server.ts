// Production wiring for the demonstration-agent runner.
// SERVER ONLY.

import { createSupabaseDemoStore } from "./store.server";
import { createDeepSeekClient } from "./deepseek.server";
import { readDemoEnv } from "./config.server";
import { runDemoAgent, type RunOptions, type RunOutcome } from "./runner";

/** Executes at most one demonstration action against the live database. */
export async function runOneDemoAction(
  options: Pick<RunOptions, "triggerType" | "agentId" | "personaKey">,
): Promise<RunOutcome> {
  return runDemoAgent(
    {
      store: createSupabaseDemoStore(),
      deepseek: createDeepSeekClient(),
      env: readDemoEnv(),
      now: () => new Date(),
      random: Math.random,
    },
    options,
  );
}
