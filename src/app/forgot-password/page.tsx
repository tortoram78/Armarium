import Link from "next/link";
import { headers } from "next/headers";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { AuthCard } from "@/components/AuthCard";
import { isAuthConfigured } from "@/lib/auth";

/**
 * Resolve the public origin for the password-reset redirect, SSR-safe.
 *
 * Order of preference:
 *   1. NEXT_PUBLIC_SITE_URL  — explicit canonical origin (set this in prod).
 *   2. The forwarded request headers (proto + host) — works behind Vercel's
 *      proxy without hardcoding anything.
 *   3. VERCEL_URL            — last-resort deployment hostname.
 *
 * Never falls back to localhost in a string we hand to Supabase: if nothing is
 * resolvable we return null and the action surfaces a neutral message rather
 * than emailing a broken link.
 */
function resolveOrigin(): string | null {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

  return null;
}

/**
 * Server action: request a password-reset email via Supabase Auth.
 *
 * Always returns the same neutral confirmation regardless of whether the email
 * maps to a real account — no account enumeration. Real errors are swallowed
 * into the same neutral state on purpose; the only surfaced error is the
 * unconfigured-environment case.
 */
async function forgotPasswordAction(formData: FormData): Promise<{ error: string } | undefined> {
  "use server";
  if (!isAuthConfigured()) {
    return { error: "Auth is not configured in this environment." };
  }
  const origin = resolveOrigin();
  if (!origin) {
    // Can't build a valid redirect — fail closed but stay neutral to the user.
    return undefined;
  }

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = createClient();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  // We intentionally ignore the result/error: surfacing "no such user" here
  // would leak which addresses are registered.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/update-password`,
  });

  return undefined;
}

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      tagline="Recover access to your gear closet."
      code="RX"
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="font-medium text-blaze underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <ForgotPasswordForm action={forgotPasswordAction} />
    </AuthCard>
  );
}
