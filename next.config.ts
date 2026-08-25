import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Version-skew protection: a stale client (month-old tab, installed iOS
  // PWA) detects the server's newer deployment id on any client-side
  // navigation and hard-reloads instead of requesting chunks the deploy no
  // longer serves. NEXT_DEPLOYMENT_ID wins if Vercel Skew Protection is ever
  // enabled; otherwise the Vercel system vars identify the deploy. Unset
  // locally, which disables the mechanism in dev.
  deploymentId:
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.VERCEL_GIT_COMMIT_SHA,
};

export default nextConfig;
