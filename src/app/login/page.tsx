import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";
import { AuthCard } from "@/components/AuthCard";
import { isAuthConfigured } from "@/lib/auth";

/**
 * Sanitize a `next` redirect target. ONLY same-origin relative paths ("/…") are honored — protocol-relative
 * ("//evil") and absolute URLs are rejected (open-redirect guard). Absent/invalid → null (default to "/").
 */
function safeNext(raw: string | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

/**
 * Server action: sign in with email + password via Supabase Auth.
 * Returns an error object on failure (surfaced in the client form), or redirects on success.
 *
 * Honors a `next` field (the demo-funnel save-wall passes /plan?conditions=… so a returning user lands on a
 * pre-filled planner). It is re-sanitized HERE (defense in depth — the form value is untrusted) and falls
 * back to "/" when absent/invalid, so the default flow is byte-unchanged when no `next` is present. This is
 * a redirect-to-prefill bridge ONLY: it never auto-creates or auto-saves a trip (deferred per ADR-0016).
 */
async function loginAction(formData: FormData): Promise<{ error: string } | undefined> {
  "use server";
  const next = safeNext(String(formData.get("next") ?? "") || undefined) ?? "/";
  if (!isAuthConfigured()) {
    redirect(next);
  }
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = createClient();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.message };
  }
  redirect(next);
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const next = safeNext(searchParams.next);
  // Preserve `next` on the "create one" link so the funnel survives a detour to sign-up.
  const signupHref = next ? `/signup?next=${encodeURIComponent(next)}` : "/signup";

  return (
    <AuthCard
      heading="Welcome back"
      tagline="Sign in to access your gear closet."
      footer={
        <>
          No account?{" "}
          <Link
            href={signupHref}
            className="font-medium text-foreground underline-offset-4 transition-colors hover:text-accent hover:underline"
          >
            Create one
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
      <LoginForm action={loginAction} next={next ?? undefined} />
    </AuthCard>
  );
}
