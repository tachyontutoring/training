import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the tracing root to this project — there's another lockfile in the
  // parent directory that Next would otherwise infer as the workspace root.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
