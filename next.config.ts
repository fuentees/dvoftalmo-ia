import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: rootDir,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb"
    }
  },
  // Keep native Node.js packages out of the webpack bundle
  serverExternalPackages: ["mysql2", "pdf-parse", "mammoth"]
};

export default nextConfig;
