import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Armarium</h1>
      <p className="mt-1 text-sm text-neutral-500">Sign in to access your gear closet.</p>
      <LoginForm action={loginAction} />
      <p className="mt-4 text-center text-sm text-neutral-500">
        No account?{" "}
        <Link href="/signup" className="underline hover:text-neutral-900">
          Create one
        </Link>
      </p>
    </main>
  );
}
