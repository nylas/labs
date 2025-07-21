import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Edge runtime will be configured per route
  webpack: (config, { isServer }) => {
    // Ensure styled-jsx is properly resolved
    config.resolve.fallback = {
      ...config.resolve.fallback,
      'styled-jsx': require.resolve('styled-jsx'),
    };
    
    return config;
  },
};

export default nextConfig;
