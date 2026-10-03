/**
 * Runtime configuration. Every value is read from the process environment at
 * call time (never inlined at build time), so the same image runs anywhere.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  /** dbmate + app SQLite URL, e.g. `sqlite:./data/relay.db`. */
  databaseUrl(): string {
    return process.env.DATABASE_URL ?? "sqlite:./data/relay.db";
  },
  /** Filesystem path for node:sqlite, derived from DATABASE_URL. */
  sqlitePath(): string {
    return env.databaseUrl().replace(/^sqlite:/, "");
  },
  adminPassword(): string {
    return required("RELAY_ADMIN_PASSWORD");
  },
  sessionSecret(): string {
    return required("RELAY_SESSION_SECRET");
  },
  anthropicApiBase(): string {
    return (process.env.ANTHROPIC_API_BASE ?? "https://api.anthropic.com").replace(
      /\/$/,
      "",
    );
  },
  port(): number {
    return Number(process.env.PORT ?? 3000);
  },
};
