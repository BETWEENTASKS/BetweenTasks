import { describe, expect, test } from "bun:test";
import {
  clearSessionCookie,
  hashSecret,
  secureToken,
  sessionCookie,
  validatePlainText,
} from "../security";
describe("anonymous conversation security", () => {
  test("tokens carry at least 256 bits and only hashes are stable", async () => {
    const token = secureToken();
    expect(token).toMatch(/^btc_[a-f0-9]{64}$/);
    expect(await hashSecret(token)).toHaveLength(64);
    expect(await hashSecret(token)).not.toContain(token);
  });
  test("plain text enforces size and rejects active markup", () => {
    expect(validatePlainText("hello").ok).toBe(true);
    expect(validatePlainText("x".repeat(2001)).ok).toBe(false);
    expect(validatePlainText("<script>alert(1)</script>").ok).toBe(false);
    expect(validatePlainText("javascript:alert(1)").ok).toBe(false);
  });
  test("owner cookie is http-only, strict, secure, scoped, and revocable", () => {
    const value = sessionCookie("secret");
    expect(value).toContain("HttpOnly");
    expect(value).toContain("SameSite=Strict");
    expect(value).toContain("Secure");
    expect(value).toContain("Path=/");
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });
});
