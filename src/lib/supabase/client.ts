import { createBrowserClient } from "@supabase/ssr";

/**
 * Creates a Supabase browser client.
 * Safe to import when env vars are absent — the client simply won't be functional,
 * but module evaluation never throws.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
