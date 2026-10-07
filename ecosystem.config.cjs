// pm2 process definition. Run from the project root:
//   pm2 start ecosystem.config.cjs
//   pm2 save
//
// scripts/start.mjs loads .env, applies dbmate migrations, then runs
// `next start`. pm2 only supervises the process; it does not run migrations
// itself, so they can never be skipped.
module.exports = {
  apps: [
    {
      name: "claude-relay",
      script: "scripts/start.mjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      // One relay process owns the SQLite file and the OAuth callback ports.
      // Cluster mode would start several, so keep it single-instance.
      kill_timeout: 5000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
