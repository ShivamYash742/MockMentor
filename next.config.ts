import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Development-only double-invocation of effects, to catch effects that don't clean up.
  reactStrictMode: true,
};

export default nextConfig;
