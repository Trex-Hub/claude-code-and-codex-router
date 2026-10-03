// Production start: apply migrations, then run the standalone server.
//
// Mirrors docker/entrypoint.sh so `pnpm start` can never boot against an
// un-migrated (empty) database. Loads the project-root .env itself, because the
// standalone server would otherwise look for .env inside .next/standalone.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// The standalone server chdirs into .next/standalone, so a relative sqlite
// path would resolve to a different file than the one dbmate migrated.
// Pin it to an absolute path shared by both.
let url = process.env.DATABASE_URL ?? "sqlite:./data/relay.db";
if (url.startsWith("sqlite:")) {
  const dbPath = url.slice("sqlite:".length);
  if (dbPath !== ":memory:" && !isAbsolute(dbPath)) {
    url = `sqlite:${resolve(process.cwd(), dbPath)}`;
  }
}
process.env.DATABASE_URL = url;

const dbPath = url.replace(/^sqlite:/, "");
if (dbPath !== ":memory:") {
  mkdirSync(dirname(dbPath), { recursive: true });
}

console.log(`[claude-relay] migrating ${dbPath} ...`);
const migrate = spawnSync("dbmate", ["--no-dump-schema", "up"], {
  stdio: "inherit",
  env: process.env,
});

if (migrate.error) {
  console.error(
    "[claude-relay] could not run dbmate. Install it (https://github.com/amacneil/dbmate) " +
      "or run migrations yourself, e.g. `DATABASE_URL=... dbmate up`.\n" +
      `  cause: ${migrate.error.message}`,
  );
  process.exit(1);
}
if (migrate.status !== 0) {
  process.exit(migrate.status ?? 1);
}

const server = spawn(process.execPath, [".next/standalone/server.js"], {
  stdio: "inherit",
  env: process.env,
});
server.on("exit", (code) => process.exit(code ?? 0));
