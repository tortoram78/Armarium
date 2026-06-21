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

export default function SignupPage() {
  return (
    <AuthCard
      tagline="Create an account to start building your closet."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm action={signupAction} />
    </AuthCard>
  );
}
