export function fakeJwt(claims: Record<string, unknown>): string {
  const enc = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "none" })}.${enc(claims)}.sig`;
}

export const CODEX_JWT = fakeJwt({
  "https://api.openai.com/auth": {
    chatgpt_account_id: "acct_abc",
    chatgpt_plan_type: "plus",
  },
  "https://api.openai.com/profile": { email: "dev@example.com" },
});
