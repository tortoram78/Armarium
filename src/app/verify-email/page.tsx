import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { Button } from "@/components/ui/button";
import { isAuthConfigured, getSessionUser } from "@/lib/auth";
import { signOutAction } from "@/app/actions";

export const dynamic = "force-dynamic";

/**
 * Resend the email-confirmation link for the signed-in-but-unconfirmed account. Rate-limited on the
 * "signup" budget (per-IP) so it can't be used to spray confirmation mail. RSC-safe: a plain form posting
 * a server action that redirects back with a status query param (no client handler crosses the boundary).
 */
async function resendAction(): Promise<void> {
  "use server";
  if (!isAuthConfigured()) redirect("/");
  const { resolveRateKey, checkRateLimitAsync } = await import("@/server/ratelimit-guard");
  if (!(await checkRateLimitAsync("signup", await resolveRateKey())).allowed) {
    redirect("/verify-email?error=rate");
  }
  const u = await getSessionUser();
  if (!u?.email) redirect("/verify-email?error=noemail");
  const { createClient } = await import("@/lib/supabase/server");
  const { error } = await createClient().auth.resend({ type: "signup", email: u.email });
  redirect(error ? "/verify-email?error=send" : "/verify-email?sent=1");
}

const ERROR_COPY: Record<string, string> = {
  rate: "Too many requests — wait a moment before resending.",
  noemail: "No email is associated with this session. Sign out and sign up again.",
  send: "Couldn't resend right now — please try again shortly.",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  // Only a configured deployment has an email-confirmation flow. Dev/passthrough has no concept of it.
  if (!isAuthConfigured()) redirect("/");
  const u = await getSessionUser();
  if (!u) redirect("/login"); // not signed in → nothing to verify
  if (u.emailVerified) redirect("/"); // already confirmed → into the app

  const sent = searchParams.sent === "1";
  const error = searchParams.error ? ERROR_COPY[searchParams.error] : undefined;

  return (
    <AuthCard
      heading="Confirm your email"
      tagline={
        u.email
          ? `We sent a confirmation link to ${u.email}. Click it to activate your closet.`
          : "We sent a confirmation link to your email. Click it to activate your closet."
      }
      footer={
        <>
          Wrong account?{" "}
          <form action={signOutAction} className="inline">
            <button
              type="submit"
              className="font-medium text-foreground underline-offset-4 transition-colors hover:text-accent hover:underline"
            >
              Sign out
            </button>
          </form>
        </>
      }
    >
      <div className="space-y-5">
        {sent && (
          <p className="rounded-md border-l-2 border-l-primary bg-primary/5 px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
            Confirmation email sent. Check your inbox (and spam).
          </p>
        )}
        {error && (
          <p className="rounded-md border-l-2 border-l-accent bg-accent/5 px-3.5 py-2.5 text-sm leading-relaxed text-accent">
            {error}
          </p>
        )}
        <p className="text-sm leading-relaxed text-muted-foreground">
          Didn&apos;t get the email? Check your spam folder, or resend it below. Once confirmed, continue
          to your closet.
        </p>
        <form action={resendAction}>
          <Button type="submit" variant="outline" className="w-full">
            Resend confirmation email
          </Button>
        </form>
        <Link
          href="/"
          className="block text-center text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          I&apos;ve confirmed — continue
        </Link>
      </div>
    </AuthCard>
  );
}
