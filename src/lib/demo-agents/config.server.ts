// Environment configuration for the demonstration-agent system.
// SERVER ONLY. Nothing here is ever serialized to the browser.

export type DemoEnv = {
  /** Master gate. Every DeepSeek call is refused unless this is exactly "true". */
  enabled: boolean;
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
  /** Environment ceilings. Undefined means "no environment ceiling, use settings only". */
  dailyMaxRequests: number | undefined;
  dailyMaxInputTokens: number | undefined;
  dailyMaxOutputTokens: number | undefined;
};

const DEFAULT_BASE_URL = "https://api.deepseek.com";

function readInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function readDemoEnv(): DemoEnv {
  const baseUrl = (process.env["DEEPSEEK_BASE_URL"] || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return {
    enabled: process.env["DEMO_AGENTS_ENABLED"] === "true",
    apiKeyConfigured: Boolean(process.env["DEEPSEEK_API_KEY"]?.trim()),
    baseUrl,
    // The model name is never hardcoded: an administrator changes it in the
    // deployment environment without a code change.
    model: (process.env["DEEPSEEK_MODEL"] || "").trim(),
    dailyMaxRequests: readInt("DEMO_DAILY_MAX_REQUESTS"),
    dailyMaxInputTokens: readInt("DEMO_DAILY_MAX_INPUT_TOKENS"),
    dailyMaxOutputTokens: readInt("DEMO_DAILY_MAX_OUTPUT_TOKENS"),
  };
}

/** Safe summary for the admin dashboard. Never contains a key or a key fragment. */
export function describeDemoEnv(env: DemoEnv) {
  return {
    demo_agents_enabled: env.enabled,
    deepseek_api_key: env.apiKeyConfigured ? ("Configured" as const) : ("Missing" as const),
    deepseek_base_url: env.baseUrl,
    deepseek_model: env.model || "Missing",
    env_daily_max_requests: env.dailyMaxRequests ?? null,
    env_daily_max_input_tokens: env.dailyMaxInputTokens ?? null,
    env_daily_max_output_tokens: env.dailyMaxOutputTokens ?? null,
  };
}
