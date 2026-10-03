/**
 * PKCE (RFC 7636) verifier/challenge generation, S256.
 *
 * Ported from pi-ai's `auth/oauth/pkce.ts` (verifier = base64url of 32 random
 * bytes; challenge = base64url of SHA-256(verifier)).
 */
export interface Pkce {
  verifier: string;
  challenge: string;
}

export async function generatePKCE(): Promise<Pkce> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = Buffer.from(verifierBytes).toString("base64url");

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = Buffer.from(new Uint8Array(digest)).toString("base64url");

  return { verifier, challenge };
}
