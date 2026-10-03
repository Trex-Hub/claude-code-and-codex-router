import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(process.cwd(), "src") },
  },
  // node:sqlite is a Node built-in Vite's optimizer does not know yet.
  ssr: { external: ["node:sqlite"] },
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "ant-auth/**", ".next/**"],
    server: { deps: { external: ["node:sqlite"] } },
  },
});
