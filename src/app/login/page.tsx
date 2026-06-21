import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";
import { AuthCard } from "@/components/AuthCard";
import { isAuthConfigured } from "@/lib/auth";

/**
 * Server action: sign in with email + password via Supabase Auth.
 * Returns an error object on failure (surfaced in the client form),
 * or redirects to "/" on success.
 */
async function loginAction(formData: FormData): Promise<{ error: string } | undefined> {
  "use server";
  if (!isAuthConfigured()) {
    redirect("/");
  }
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = createClient();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.message };
  }
  redirect("/");
}

export default function LoginPage() {
  return (
    <AuthCard
      tagline="Sign in to access your gear closet."
      footer={
        <>
          No account?{" "}
          <Link href="/signup" className="font-medium text-blaze underline-offset-4 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <LoginForm action={loginAction} />
    </AuthCard>
  );
}
