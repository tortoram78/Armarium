import Link from "next/link";
import { SignupForm } from "./SignupForm";
import { AuthCard } from "@/components/AuthCard";
import { isAuthConfigured } from "@/lib/auth";

/**
 * Server action: create a new account via Supabase Auth.
 * Returns an error object on failure (surfaced in the client form),
 * or undefined on success (the SignupForm shows a confirmation message).
 *
 * Throttled per-IP on the "signup" budget (~5/min) to brake scripted mass-account creation. The check uses
 * the distributed (Upstash) limiter when configured, else the in-memory fallback — see ratelimit-guard.ts.
 * A reject returns a friendly message; internals are never leaked.
 */
/**
 * Map a raw Supabase auth error to a SMALL set of neutral, user-safe strings. Two goals:
 *   - No account enumeration: a "user already registered" error is folded into the SAME generic message
 *     as a generic failure, so a signup attempt never confirms whether an address already has an account
 *     (the forgot-password flow is the model — it never reveals which addresses are registered).
 *   - No internal leakage: raw Supabase/internal messages are never surfaced verbatim.
 * Only the two cases a user can act on (weak password, malformed email) get their own message; everything
 * else collapses to one neutral line.
 */
function neutralSignupError(raw: string | undefined): string {
  const m = (raw ?? "").toLowerCase();
  if (m.includes("password")) {
    return "Please choose a password with at least 6 characters.";
  }
  if (m.includes("email") && (m.includes("invalid") || m.includes("valid"))) {
    return "Please enter a valid email address.";
  }
  if (m.includes("rate") || m.includes("too many")) {
    return "Too many attempts — please wait a moment and try again.";
  }
  // Generic catch-all — also covers "user already registered" so we never confirm an address exists.
  return "We couldn't create your account. Please check your details and try again.";
}

async function signupAction(formData: FormData): Promise<{ error: string } | undefined> {
  "use server";
  if (!isAuthConfigured()) {
    return { error: "Auth is not configured in this environment." };
  }

  const { resolveRateKey, checkRateLimitAsync } = await import("@/server/ratelimit-guard");
  const rateKey = await resolveRateKey();
  if (!(await checkRateLimitAsync("signup", rateKey)).allowed) {
    return { error: "Too many attempts — please wait a moment and try again." };
  }

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = createClient();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    return { error: neutralSignupError(error.message) };
  }
}

/** Only same-origin relative paths are honored (open-redirect guard); absent/invalid → null. */
function safeNext(raw: string | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export default function SignupPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  // Carry `next` to the "Sign in" link so the demo-funnel prefill survives a detour to sign-up. (Sign-up
  // itself uses an email-confirmation flow — no session is created here — so there is no save-on-signup.)
  const next = safeNext(searchParams.next);
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <AuthCard
      heading="Create your closet"
      tagline="Set up an account to start building your gear closet."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={loginHref}
            className="font-medium text-foreground underline-offset-4 transition-colors hover:text-accent hover:underline"
          >
            Sign in
          </Link>
          <span className="mt-2 block text-xs text-muted-foreground">
            <Link
              href="/privacy"
              className="underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Privacy
            </Link>
            {" · "}
            <Link
              href="/terms"
              className="underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Terms
            </Link>
          </span>
        </>
      }
    >
      <SignupForm action={signupAction} />
    </AuthCard>
  );
}
