import type { NextConfig } from "next";
import { tileConfigFromEnv } from "./src/lib/map-config";
import { supabaseConfigFromEnv } from "./src/lib/supabase/config";

// The basemap env is inlined into client code; checking it here fails dev and build instead.
tileConfigFromEnv();
// Every API route needs the Supabase project; a missing value fails dev and build, not a request.
supabaseConfigFromEnv();

const nextConfig: NextConfig = {
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
