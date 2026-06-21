import Link from "next/link";
import { SignupForm } from "./SignupForm";
import { isAuthConfigured } from "@/lib/auth";

/**
 * Server action: create a new account via Supabase Auth.
 * Returns an error object on failure (surfaced in the client form),
 * or undefined on success (the SignupForm shows a confirmation message).
 * Note: if the Supabase project has email confirmation enabled the user
 * must confirm before they can sign in.
 */
async function signupAction(formData: FormData): Promise<{ error: string } | undefined> {
  "use server";
  if (!isAuthConfigured()) {
    // Dev mode — no auth configured, nothing to sign up for.
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
  // Success — SignupForm shows the confirmation message; no redirect here
  // because if email confirmation is required the user can't log in yet.
}

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Armarium</h1>
      <p className="mt-1 text-sm text-neutral-500">Create an account to start building your closet.</p>
      <SignupForm action={signupAction} />
      <p className="mt-4 text-center text-sm text-neutral-500">
        Already have an account?{" "}
        <Link href="/login" className="underline hover:text-neutral-900">
          Sign in
        </Link>
      </p>
    </main>
  );
}
