import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (exports point at .ts); Next
  // compiles them alongside the app.
  transpilePackages: ["@packroi/ev"],
};

export default nextConfig;
