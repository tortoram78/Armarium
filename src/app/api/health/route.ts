// GET /api/health — a tiny, dependency-free liveness + configuration probe for ops (uptime checks,
// "is auth actually on in this deploy?" sanity). It reports ENV PRESENCE ONLY as booleans — it never
// reads, returns, or logs any secret value, opens a DB connection, or calls Anthropic. Never throws.
//
// `auth: true` confirms both NEXT_PUBLIC_SUPABASE_* vars are set (the app is NOT in the no-auth
// passthrough footgun — see .env.example). `db`/`llm` confirm the backing services are configured.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    // ENV PRESENCE ONLY — Boolean() coerces away the value; nothing secret is ever serialized.
    auth: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    db: Boolean(process.env.DATABASE_URL),
    llm: Boolean(process.env.ANTHROPIC_API_KEY),
    ts: new Date().toISOString(),
  });
}
