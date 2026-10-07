/** @type {import('next').NextConfig} */
const nextConfig = {
  // node:sqlite and node:crypto are server-only built-ins; keep route handlers on
  // the nodejs runtime (the default) so they resolve.
  serverExternalPackages: [],
};

export default nextConfig;
