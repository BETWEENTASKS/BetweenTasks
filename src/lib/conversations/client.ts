/** Fragment credentials always win over an older browser-restored credential. */
export function selectRecoveryToken(hash: string, stored: string | null): string {
  const fragment = hash.startsWith("#access=") ? hash.slice("#access=".length) : "";
  return fragment || stored || "";
}

export function restoreConversationAccess(
  hash: string,
  stored: string | null,
  persist: (token: string) => void,
  clearFragment: () => void,
) {
  const token = selectRecoveryToken(hash, stored);
  if (hash.startsWith("#access=")) {
    if (token) persist(token);
    clearFragment();
  }
  return token;
}

export async function ensureConversationForFirstMessage(
  token: string,
  start: () => Promise<string>,
) {
  return token || start();
}
