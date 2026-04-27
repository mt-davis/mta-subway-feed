import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
  serverExternalPackages: ["gtfs-realtime-bindings"],
  // Hide the Next.js dev badge so it doesn't sit on top of the map controls.
  devIndicators: false,
};

export default nextConfig;
