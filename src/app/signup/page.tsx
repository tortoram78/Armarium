import Link from "next/link";
import { SignupForm } from "./SignupForm";
import { AuthCard } from "@/components/AuthCard";
import { isAuthConfigured } from "@/lib/auth";

/**
 * Server action: create a new account via Supabase Auth.
 * Returns an error object on failure (surfaced in the client form),
 * or undefined on success (the SignupForm shows a confirmation message).
 */
async function signupAction(formData: FormData): Promise<{ error: string } | undefined> {
  "use server";
  if (!isAuthConfigured()) {
    return { error: "Auth is not configured in this environment." };
  }
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = createClient();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    return { error: error.message };
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
        </>
      }
    >
      <SignupForm action={signupAction} />
    </AuthCard>
  );
}
