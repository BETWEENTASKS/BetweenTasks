export const MAX_MESSAGE_LENGTH = 2_000;
export const MAX_REQUEST_BYTES = 8_192;

export async function hashSecret(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 32 random bytes = 256 bits of entropy. */
export function secureToken(prefix = "btc_"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const encoded = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}${encoded}`;
}

export function guestAlias(): string {
  const adjectives = ["Amber", "Brisk", "Clever", "Quiet", "Silver", "Warm"];
  const nouns = ["Comet", "Fox", "Moth", "Otter", "Raven", "Star"];
  const random = crypto.getRandomValues(new Uint32Array(3));
  return `${adjectives[random[0]! % adjectives.length]} ${nouns[random[1]! % nouns.length]} ${String(random[2]! % 10_000).padStart(4, "0")}`;
}

export function validatePlainText(value: unknown, maximum = MAX_MESSAGE_LENGTH) {
  if (typeof value !== "string")
    return { ok: false as const, message: "A plain-text message is required." };
  const content = value.trim();
  if (!content || content.length > maximum)
    return { ok: false as const, message: `Message must be 1-${maximum} characters.` };
  // Text is rendered by React, never as HTML. Reject active/encoded markup as an additional guard.
  if (/<\/?[a-z!][^>]*>|javascript:|data:text\/html|&#(?:x?[0-9a-f]+);/iu.test(content)) {
    return { ok: false as const, message: "Markup, scripts, and data URLs are not accepted." };
  }
  return { ok: true as const, content };
}

export function sessionCookie(token: string, secure = true): string {
  return `bt_owner_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure = true): string {
  return `bt_owner_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function cookieValue(header: string | null, name: string): string | null {
  const part = (header ?? "")
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

export async function readBoundedJson(request: Request, maximumBytes = MAX_REQUEST_BYTES) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > maximumBytes)
    return { ok: false as const, tooLarge: true as const };
  try {
    const value = JSON.parse(raw || "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { ok: false as const, tooLarge: false as const };
    return { ok: true as const, value: value as Record<string, unknown> };
  } catch {
    return { ok: false as const, tooLarge: false as const };
  }
}
