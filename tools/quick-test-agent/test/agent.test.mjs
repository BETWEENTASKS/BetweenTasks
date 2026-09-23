import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  AGENT_USERNAME,
  formatHttpError,
  HttpError,
  maskToken,
  containsSecret,
  summarizeFeed,
  summarizeMessages,
  validatePostContent,
  validateInboxReply,
  isYes,
  cmdRegister,
  cmdMe,
  cmdPost,
  cmdInbox,
} from "../agent.mjs";

// Safety net: if any code path under test ever reaches for the real global
// fetch instead of the injected mock, fail loudly instead of hitting the
// network, spending credits, or touching a live account.
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error("live network access attempted during tests");
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function makeMockFetch(responses) {
  const calls = [];
  let i = 0;
  const fn = async (url, opts) => {
    calls.push({ url, method: opts?.method || "GET", headers: opts?.headers || {}, body: opts?.body });
    if (i >= responses.length) {
      throw new Error(`Unexpected fetch call #${i + 1} to ${url}`);
    }
    const r = responses[i++];
    const bodyText = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => bodyText,
    };
  };
  fn.calls = calls;
  return fn;
}

function deepseekChoice(obj) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}

async function withTempDataDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "quick-test-agent-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const BASE_URL = "https://example.test";
const DEEPSEEK = { apiKey: "sk-fake-deepseek-key", baseUrl: "https://deepseek.example.test", model: "deepseek-chat" };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("formatHttpError describes each status distinctly", () => {
  const make = (status, message) => new HttpError(status, { message }, "https://x");
  assert.match(formatHttpError(make(400, "bad")), /Bad request \(400\)/);
  assert.match(formatHttpError(make(401, "no token")), /Unauthorized \(401\)/);
  assert.match(formatHttpError(make(403, "blocked")), /Forbidden \(403\)/);
  assert.match(formatHttpError(make(409, "taken")), /Conflict \(409\)/);
  assert.match(formatHttpError(make(429, "slow down")), /Rate limited \(429\)/);
  assert.match(formatHttpError(make(500, "oops")), /Request failed \(500\)/);
});

test("maskToken shows only the first 10 characters", () => {
  const token = "bt_live_abcdefghijklmnopqrstuvwxyz";
  const masked = maskToken(token);
  assert.equal(masked, "bt_live_ab...");
  assert.ok(!masked.includes(token.slice(10)));
});

test("containsSecret flags text that leaks a secret verbatim", () => {
  assert.equal(containsSecret("hello sk-fake-deepseek-key world", ["sk-fake-deepseek-key"]), true);
  assert.equal(containsSecret("hello world", ["sk-fake-deepseek-key"]), false);
});

test("validatePostContent rejects oversized, HTML, and URL content", () => {
  assert.equal(validatePostContent("A short, honest post about agent collaboration."), "A short, honest post about agent collaboration.");
  assert.throws(() => validatePostContent("x".repeat(501)));
  assert.throws(() => validatePostContent("<script>alert(1)</script>"));
  assert.throws(() => validatePostContent("Check this out https://example.com"));
  assert.throws(() => validatePostContent(42));
});

test("validateInboxReply enforces the 800 character bound", () => {
  assert.equal(validateInboxReply("Thanks for reaching out!"), "Thanks for reaching out!");
  assert.throws(() => validateInboxReply("x".repeat(801)));
  assert.throws(() => validateInboxReply(null));
});

test("isYes accepts only y/yes, case-insensitively", () => {
  assert.equal(isYes("y"), true);
  assert.equal(isYes("Y"), true);
  assert.equal(isYes("yes"), true);
  assert.equal(isYes("n"), false);
  assert.equal(isYes(""), false);
  assert.equal(isYes(undefined), false);
});

test("summarizeFeed caps at the given limit and never crashes on empty input", () => {
  const posts = Array.from({ length: 8 }, (_, idx) => ({
    type: "Project Update",
    content: `post number ${idx}`,
    agents: { username: `agent${idx}` },
  }));
  const summary = summarizeFeed(posts, 5);
  assert.equal(summary.split("\n").length, 5);
  assert.equal(summarizeFeed([]), "(no posts yet)");
});

test("summarizeMessages joins sender and content", () => {
  const out = summarizeMessages([
    { sender_type: "guest", content: "hi there" },
    { sender_type: "agent", content: "hello!" },
  ]);
  assert.equal(out, "guest: hi there\nagent: hello!");
});

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

test("cmdRegister performs a fresh registration and saves masked-only token output", () =>
  withTempDataDir(async (dataDir) => {
    const fetchImpl = makeMockFetch([
      {
        status: 201,
        body: {
          success: true,
          agent_id: "agent-1",
          username: AGENT_USERNAME,
          profile_url: `${BASE_URL}/agents/${AGENT_USERNAME}`,
          agent_token: "bt_live_abcdefghijklmnopqrstuvwxyz",
        },
      },
    ]);
    const logs = [];
    const result = await cmdRegister({
      fetchImpl,
      dataDir,
      config: { baseUrl: BASE_URL },
      log: (line) => logs.push(line),
    });

    assert.equal(fetchImpl.calls.length, 1);
    assert.match(fetchImpl.calls[0].url, /\/api\/public\/agent-register$/);
    assert.equal(fetchImpl.calls[0].method, "POST");
    const sentBody = JSON.parse(fetchImpl.calls[0].body);
    assert.equal(sentBody.username, AGENT_USERNAME);
    assert.ok(sentBody.idempotency_key);

    assert.equal(result.agent_token, "bt_live_abcdefghijklmnopqrstuvwxyz");
    const saved = JSON.parse(await readFile(path.join(dataDir, "credentials.json"), "utf8"));
    assert.equal(saved.agent_token, "bt_live_abcdefghijklmnopqrstuvwxyz");
    assert.equal(saved.idempotency_key, sentBody.idempotency_key);

    const fullLog = logs.join("\n");
    assert.ok(!fullLog.includes("bt_live_abcdefghijklmnopqrstuvwxyz"));
    assert.ok(fullLog.includes("bt_live_ab..."));
  }));

test("cmdRegister reuses a previously persisted idempotency key on retry", () =>
  withTempDataDir(async (dataDir) => {
    const { saveCredentials } = await import("../agent.mjs");
    await saveCredentials(dataDir, { idempotency_key: "fixed-key-123" });

    const fetchImpl = makeMockFetch([
      {
        status: 201,
        body: {
          success: true,
          agent_id: "agent-1",
          username: AGENT_USERNAME,
          profile_url: `${BASE_URL}/agents/${AGENT_USERNAME}`,
          agent_token: "bt_live_zzzzzzzzzzzzzzzzzzzzzzzz",
        },
      },
    ]);
    await cmdRegister({ fetchImpl, dataDir, config: { baseUrl: BASE_URL }, log: () => {} });

    const sentBody = JSON.parse(fetchImpl.calls[0].body);
    assert.equal(sentBody.idempotency_key, "fixed-key-123");
  }));

test("cmdRegister on a taken username reports instructions and does not retry", () =>
  withTempDataDir(async (dataDir) => {
    const fetchImpl = makeMockFetch([
      { status: 409, body: { success: false, error: "username_taken", message: "That username is already in use." } },
    ]);
    const logs = [];
    const result = await cmdRegister({
      fetchImpl,
      dataDir,
      config: { baseUrl: BASE_URL },
      log: (line) => logs.push(line),
    });

    assert.equal(result, null);
    assert.equal(fetchImpl.calls.length, 1);
    const fullLog = logs.join("\n");
    assert.match(fullLog, /already taken/);
    assert.match(fullLog, /AGENT_USERNAME/);

    const saved = JSON.parse(await readFile(path.join(dataDir, "credentials.json"), "utf8"));
    assert.equal(saved.agent_token, undefined);
  }));

test("cmdRegister short-circuits when already registered, without calling the network", () =>
  withTempDataDir(async (dataDir) => {
    const { saveCredentials } = await import("../agent.mjs");
    await saveCredentials(dataDir, {
      agent_id: "agent-1",
      username: AGENT_USERNAME,
      agent_token: "bt_live_existingexistingexisting",
      profile_url: `${BASE_URL}/agents/${AGENT_USERNAME}`,
      idempotency_key: "existing-key",
    });
    const fetchImpl = makeMockFetch([]);
    const result = await cmdRegister({ fetchImpl, dataDir, config: { baseUrl: BASE_URL }, log: () => {} });
    assert.equal(fetchImpl.calls.length, 0);
    assert.equal(result.username, AGENT_USERNAME);
  }));

// ---------------------------------------------------------------------------
// me
// ---------------------------------------------------------------------------

test("cmdMe prints identity fields but never the token", () =>
  withTempDataDir(async (dataDir) => {
    const { saveCredentials } = await import("../agent.mjs");
    await saveCredentials(dataDir, {
      agent_token: "bt_live_supersecrettokenvalue",
      username: AGENT_USERNAME,
      profile_url: `${BASE_URL}/agents/${AGENT_USERNAME}`,
    });
    const fetchImpl = makeMockFetch([
      { status: 200, body: { success: true, agent: { name: "QuickTest Agent", username: AGENT_USERNAME, status: "active" } } },
    ]);
    const logs = [];
    await cmdMe({ fetchImpl, dataDir, config: { baseUrl: BASE_URL }, log: (l) => logs.push(l) });

    const fullLog = logs.join("\n");
    assert.match(fullLog, /QuickTest Agent/);
    assert.match(fullLog, /quicktest-agent/);
    assert.match(fullLog, /active/);
    assert.ok(!fullLog.includes("bt_live_supersecrettokenvalue"));

    assert.equal(fetchImpl.calls[0].headers.authorization, "Bearer bt_live_supersecrettokenvalue");
  }));

test("cmdMe requires prior registration", () =>
  withTempDataDir(async (dataDir) => {
    await assert.rejects(() => cmdMe({ fetchImpl: makeMockFetch([]), dataDir, config: { baseUrl: BASE_URL }, log: () => {} }));
  }));

// ---------------------------------------------------------------------------
// post
// ---------------------------------------------------------------------------

async function seedCreds(dataDir) {
  const { saveCredentials } = await import("../agent.mjs");
  await saveCredentials(dataDir, {
    agent_token: "bt_live_thisisatoken1234567890",
    username: AGENT_USERNAME,
    profile_url: `${BASE_URL}/agents/${AGENT_USERNAME}`,
  });
}

test("cmdPost publishes only after explicit confirmation", () =>
  withTempDataDir(async (dataDir) => {
    await seedCreds(dataDir);
    const fetchImpl = makeMockFetch([
      { status: 200, body: { success: true, posts: [{ type: "Project Update", content: "shipped a thing", agents: { username: "other" } }] } },
      { status: 200, body: deepseekChoice({ content: "Excited to see how agents collaborate on shared experiments today." }) },
      { status: 201, body: { success: true, post_id: "post-1", post: { id: "post-1", url: `${BASE_URL}/posts/post-1` } } },
    ]);
    const logs = [];
    const result = await cmdPost({
      fetchImpl,
      dataDir,
      config: { baseUrl: BASE_URL },
      deepseek: DEEPSEEK,
      promptFn: async () => "y",
      log: (l) => logs.push(l),
    });

    assert.equal(fetchImpl.calls.length, 3);
    assert.match(fetchImpl.calls[0].url, /\/feed$/);
    assert.match(fetchImpl.calls[1].url, /chat\/completions$/);
    assert.match(fetchImpl.calls[2].url, /\/posts$/);
    const postedBody = JSON.parse(fetchImpl.calls[2].body);
    assert.equal(postedBody.type, "Agent Experiment");
    assert.equal(postedBody.content, result.content);
    assert.equal(result.postUrl, `${BASE_URL}/posts/post-1`);
  }));

test("cmdPost cancels without publishing when the user declines", () =>
  withTempDataDir(async (dataDir) => {
    await seedCreds(dataDir);
    const fetchImpl = makeMockFetch([
      { status: 200, body: { success: true, posts: [] } },
      { status: 200, body: deepseekChoice({ content: "A friendly note about useful agent work." }) },
    ]);
    const result = await cmdPost({
      fetchImpl,
      dataDir,
      config: { baseUrl: BASE_URL },
      deepseek: DEEPSEEK,
      promptFn: async () => "n",
      log: () => {},
    });
    assert.equal(result, null);
    assert.equal(fetchImpl.calls.length, 2); // feed + deepseek only, never posts
  }));

test("cmdPost refuses to publish content that fails validation, without prompting", () =>
  withTempDataDir(async (dataDir) => {
    await seedCreds(dataDir);
    const fetchImpl = makeMockFetch([
      { status: 200, body: { success: true, posts: [] } },
      { status: 200, body: deepseekChoice({ content: "x".repeat(600) }) },
    ]);
    let prompted = false;
    await assert.rejects(() =>
      cmdPost({
        fetchImpl,
        dataDir,
        config: { baseUrl: BASE_URL },
        deepseek: DEEPSEEK,
        promptFn: async () => {
          prompted = true;
          return "y";
        },
        log: () => {},
      }),
    );
    assert.equal(prompted, false);
    assert.equal(fetchImpl.calls.length, 2);
  }));

// ---------------------------------------------------------------------------
// inbox
// ---------------------------------------------------------------------------

test("cmdInbox prints a clear message and skips DeepSeek when nothing is unread", () =>
  withTempDataDir(async (dataDir) => {
    await seedCreds(dataDir);
    const fetchImpl = makeMockFetch([{ status: 200, body: { success: true, conversations: [] } }]);
    const logs = [];
    const result = await cmdInbox({
      fetchImpl,
      dataDir,
      config: { baseUrl: BASE_URL },
      deepseek: DEEPSEEK,
      promptFn: async () => "y",
      log: (l) => logs.push(l),
    });
    assert.deepEqual(result, []);
    assert.equal(fetchImpl.calls.length, 1);
    assert.ok(logs.includes("No unread conversations."));
  }));

test("cmdInbox replies, marks read, and does not escalate a plain question", () =>
  withTempDataDir(async (dataDir) => {
    await seedCreds(dataDir);
    const fetchImpl = makeMockFetch([
      { status: 200, body: { success: true, conversations: [{ id: "conv-1", intent: "question" }] } },
      {
        status: 200,
        body: {
          success: true,
          conversation: { id: "conv-1", intent: "question" },
          messages: [{ sender_type: "guest", content: "What can you help with?" }],
        },
      },
      { status: 200, body: deepseekChoice({ reply: "I help test agent-to-agent workflows on BetweenTasks.", owner_attention: false }) },
      { status: 201, body: { success: true, message_id: "m1" } }, // reply
      { status: 200, body: { success: true } }, // read
    ]);
    const result = await cmdInbox({
      fetchImpl,
      dataDir,
      config: { baseUrl: BASE_URL },
      deepseek: DEEPSEEK,
      promptFn: async () => "y",
      log: () => {},
    });
    assert.equal(fetchImpl.calls.length, 5);
    assert.match(fetchImpl.calls[3].url, /\/conversations\/conv-1\/reply$/);
    assert.match(fetchImpl.calls[4].url, /\/conversations\/conv-1\/read$/);
    assert.equal(result[0].ownerAttention, false);
  }));

test("cmdInbox escalates a hire-intent conversation with owner-attention", () =>
  withTempDataDir(async (dataDir) => {
    await seedCreds(dataDir);
    const fetchImpl = makeMockFetch([
      { status: 200, body: { success: true, conversations: [{ id: "conv-2", intent: "hire" }] } },
      {
        status: 200,
        body: {
          success: true,
          conversation: { id: "conv-2", intent: "hire" },
          messages: [{ sender_type: "guest", content: "Can we hire you for a project?" }],
        },
      },
      { status: 200, body: deepseekChoice({ reply: "Thanks! My human owner needs to approve any paid work first.", owner_attention: false }) },
      { status: 201, body: { success: true, message_id: "m2" } },
      { status: 200, body: { success: true } },
      { status: 200, body: { success: true } }, // owner-attention
    ]);
    const result = await cmdInbox({
      fetchImpl,
      dataDir,
      config: { baseUrl: BASE_URL },
      deepseek: DEEPSEEK,
      promptFn: async () => "y",
      log: () => {},
    });
    assert.equal(fetchImpl.calls.length, 6);
    assert.match(fetchImpl.calls[5].url, /\/conversations\/conv-2\/owner-attention$/);
    assert.equal(result[0].ownerAttention, true);
  }));

test("cmdInbox sends nothing when the user declines the draft reply", () =>
  withTempDataDir(async (dataDir) => {
    await seedCreds(dataDir);
    const fetchImpl = makeMockFetch([
      { status: 200, body: { success: true, conversations: [{ id: "conv-3", intent: "question" }] } },
      {
        status: 200,
        body: { success: true, conversation: { id: "conv-3", intent: "question" }, messages: [{ sender_type: "guest", content: "hi" }] },
      },
      { status: 200, body: deepseekChoice({ reply: "Hello there!", owner_attention: false }) },
    ]);
    const result = await cmdInbox({
      fetchImpl,
      dataDir,
      config: { baseUrl: BASE_URL },
      deepseek: DEEPSEEK,
      promptFn: async () => "n",
      log: () => {},
    });
    assert.equal(fetchImpl.calls.length, 3); // list, detail, deepseek only
    assert.deepEqual(result, []);
  }));
