// DeepSeek Chat Completions client.
// SERVER ONLY. The API key is read from the environment, sent solely in the
// Authorization header, and never logged, returned, or placed in a prompt.

import { DEEPSEEK_MAX_TOKENS, DEEPSEEK_TIMEOUT_MS } from "./limits";
import { readDemoEnv } from "./config.server";

export type DeepSeekSuccess = {
  ok: true;
  content: string;
  /** null when the completion was produced locally and no request was billed. */
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type DeepSeekFailure = {
  ok: false;
  code:
    | "missing_api_key"
    | "missing_model"
    | "invalid_api_key"
    | "provider_rate_limited"
    | "timeout"
    | "provider_error"
    | "empty_response";
  message: string;
  /** Tokens the provider reported even though the call failed, when available. */
  promptTokens?: number;
  completionTokens?: number;
};

export type DeepSeekResult = DeepSeekSuccess | DeepSeekFailure;

export type DeepSeekClient = {
  complete(input: { systemPrompt: string; userPrompt: string }): Promise<DeepSeekResult>;
};

type ChatResponse = {
  choices?: { message?: { content?: unknown } }[];
  model?: unknown;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
};

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Turns an upstream failure into a short, safe summary. Provider response bodies
 * can echo request details, so only the status and a truncated snippet are kept,
 * and any key-shaped token in the snippet is removed.
 */
function safeUpstreamMessage(status: number, body: string): string {
  const redacted = body
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return `DeepSeek responded ${status}: ${redacted.slice(0, 200)}`;
}

export function createDeepSeekClient(): DeepSeekClient {
  return {
    async complete({ systemPrompt, userPrompt }) {
      const env = readDemoEnv();
      const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
      if (!apiKey) {
        return {
          ok: false,
          code: "missing_api_key",
          message: "DEEPSEEK_API_KEY is not configured.",
        };
      }
      if (!env.model) {
        return { ok: false, code: "missing_model", message: "DEEPSEEK_MODEL is not configured." };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(`${env.baseUrl}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: env.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
            temperature: 0.8,
            max_tokens: DEEPSEEK_MAX_TOKENS,
            stream: false,
          }),
        });
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        return aborted
          ? {
              ok: false,
              code: "timeout",
              message: `DeepSeek did not respond within ${DEEPSEEK_TIMEOUT_MS}ms.`,
            }
          : { ok: false, code: "provider_error", message: "Could not reach the DeepSeek API." };
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403) {
          return {
            ok: false,
            code: "invalid_api_key",
            message: "DeepSeek rejected the configured API key.",
          };
        }
        if (response.status === 429) {
          return {
            ok: false,
            code: "provider_rate_limited",
            message: "DeepSeek rate limit reached.",
          };
        }
        return {
          ok: false,
          code: "provider_error",
          message: safeUpstreamMessage(response.status, body),
        };
      }

      let payload: ChatResponse;
      try {
        payload = (await response.json()) as ChatResponse;
      } catch {
        return {
          ok: false,
          code: "empty_response",
          message: "DeepSeek returned a body that was not JSON.",
        };
      }

      const content = payload.choices?.[0]?.message?.content;
      const promptTokens = count(payload.usage?.prompt_tokens);
      const completionTokens = count(payload.usage?.completion_tokens);
      if (typeof content !== "string" || content.trim() === "") {
        return {
          ok: false,
          code: "empty_response",
          message: "DeepSeek returned no message content.",
          promptTokens,
          completionTokens,
        };
      }

      return {
        ok: true,
        content,
        model: typeof payload.model === "string" ? payload.model : env.model,
        promptTokens,
        completionTokens,
        totalTokens: count(payload.usage?.total_tokens) || promptTokens + completionTokens,
      };
    },
  };
}
