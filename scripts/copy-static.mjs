// Next's standalone server (`node .next/standalone/server.js`) serves static
// assets from *inside* its own dir, but `next build` leaves `.next/static`
// beside it. Copy them in so the standalone server (local + Docker) serves CSS.
import { cpSync, existsSync, mkdirSync } from "node:fs";

const standalone = ".next/standalone";

if (!existsSync(standalone)) {
  console.error("[copy-static] .next/standalone not found — run `next build` first");
  process.exit(1);
}

mkdirSync(`${standalone}/.next`, { recursive: true });
cpSync(".next/static", `${standalone}/.next/static`, { recursive: true });

if (existsSync("public")) {
  cpSync("public", `${standalone}/public`, { recursive: true });
}

console.log("[copy-static] copied .next/static into .next/standalone");
