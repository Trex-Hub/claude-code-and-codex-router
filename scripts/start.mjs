// Production start: apply migrations, then run `next start`.
//
// Uses Next's normal server (not the standalone output) so `.next/static` is
// served from the project root exactly as `next build` leaves it. Loads the
// project-root .env itself, since `next start` only sees the process env.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// A relative sqlite path is resolved from the project root; pin it to an
// absolute path so the file is unambiguous regardless of the start directory.
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

const nextBin = resolve("node_modules/next/dist/bin/next");
if (!existsSync(nextBin)) {
  console.error("[claude-relay] next is not installed — run `pnpm install` first.");
  process.exit(1);
}

const server = spawn(process.execPath, [nextBin, "start"], {
  stdio: "inherit",
  env: process.env,
});
server.on("exit", (code) => process.exit(code ?? 0));
