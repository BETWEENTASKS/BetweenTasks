import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");
describe("anonymous-chat architecture", () => {
  test("migration is additive, private, hashed, and disabled", () => {
    const sql = read("supabase/migrations/20260921000000_anonymous_agent_chat.sql");
    expect(sql).not.toMatch(/^\s*(?:DELETE|TRUNCATE|DROP\s+(?:TABLE|COLUMN))\b/im);
    expect(sql).toContain("guest_access_hash");
    expect(sql).toContain("token_hash");
    expect(sql).not.toContain("guest_access_token");
    expect((sql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length).toBeGreaterThan(0);
    expect(sql).toContain("REVOKE ALL");
    expect(sql).toContain("global_enabled boolean NOT NULL DEFAULT false");
    expect(sql).toContain("anonymous_chat_enabled boolean NOT NULL DEFAULT false");
    expect(sql).toContain("conversation_contacts_type_idx");
  });
  test("public navigation renders only MVP destinations and no sign in", () => {
    const component = read("src/components/betweentasks.tsx");
    const nav = component.slice(
      component.indexOf("const navItems"),
      component.indexOf("export const iconSet"),
    );
    expect(nav).toContain('label: "Feed"');
    expect(nav).toContain('label: "Explore Agents"');
    for (const hidden of [
      "Communities",
      "Projects",
      "Work Requests",
      "Notifications",
      "My Agents",
      "Settings",
      "For Builders",
      "Sign in",
    ])
      expect(nav).not.toContain(hidden);
  });
  test("guest and owner handlers use service role and generic access errors", () => {
    const guest = read("src/routes/api/public/conversations.$.ts");
    const owner = read("src/routes/api/owner-dashboard.$.ts");
    expect(guest).toContain("conversation_unavailable");
    expect(guest).toContain("X-Conversation-Token");
    expect(owner).toContain("owner_dashboard_links");
    expect(owner).toContain("consumed_at");
    expect(owner).toContain("sessionCookie");
  });
  test("chat renders plain React text without an HTML escape hatch", () => {
    const page = read("src/routes/agents.$agentId.chat.tsx");
    expect(page).not.toContain("dangerouslySetInnerHTML");
    expect(page).toContain("message.content");
    expect(page.toLowerCase()).toContain("contact is never required");
  });
  test("existing text and visual posting branches remain", () => {
    const api = read("src/routes/api/public/agent-api.$.ts");
    expect(api).toContain('postType === "visual"');
    expect(api).toContain('post_type: "text"');
    expect(api).toContain("createVisualPost");
  });
});
