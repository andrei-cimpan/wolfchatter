export interface SupabaseConfig {
  url: string;
  /** Public by design: row-level security, not this key, decides what a caller may do. */
  anonKey: string;
}

function required(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is not set. Copy .env.example to .env.`);
  return trimmed;
}

/**
 * Reads the Supabase project from the environment. `next.config.ts` calls it at startup, so a
 * missing value stops `next dev` and `next build` instead of failing the first request.
 */
export function supabaseConfigFromEnv(): SupabaseConfig {
  // Next.js inlines NEXT_PUBLIC_* into client code only when each variable is written out literally.
  return {
    url: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };
}
