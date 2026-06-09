import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb"
    }
  },
  // Keep native Node.js packages out of the webpack bundle
  serverExternalPackages: ["mysql2", "pdf-parse", "mammoth"]
};

export default nextConfig;
