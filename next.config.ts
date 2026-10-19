import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  env: {
    NEXT_PUBLIC_DEMO_MODE:
      process.env.NEXT_PUBLIC_DEMO_MODE ??
      process.env.PUBLIC_DEMO ??
      process.env.DEMO_MODE ??
      "true",
  },
};

export default nextConfig;
