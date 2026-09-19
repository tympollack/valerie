import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@digitalcanopy/supabase", "@digitalcanopy/ui"],
};

export default nextConfig;
