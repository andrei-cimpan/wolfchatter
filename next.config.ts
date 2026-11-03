import type { NextConfig } from "next";
import { tileConfigFromEnv } from "./src/lib/map-config";

// The basemap env is inlined into client code; checking it here fails dev and build instead.
tileConfigFromEnv();

const nextConfig: NextConfig = {
  // A self-contained server for the Docker image only: `next start` warns about this output.
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
