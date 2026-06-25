import Link from "next/link";
import { UpdatePasswordForm } from "./UpdatePasswordForm";
import { AuthCard } from "@/components/AuthCard";
import { isAuthConfigured } from "@/lib/auth";

/**
 * Landing page for the emailed password-reset link.
 *
 * Supabase establishes a short-lived recovery session from the link's token
 * (in the URL fragment) on the client, emitting a PASSWORD_RECOVERY event.
 * All of that — plus the new-password form and the updateUser call — must run
 * in a "use client" component (interactive auth state + onSubmit never belong
 * on a Server Component). This page only decides the dev-mode notice.
 */
export default function UpdatePasswordPage() {
  return (
    <AuthCard
      heading="Set a new password"
      tagline="Choose a new password for your account."
      footer={
        <>
          Link expired?{" "}
          <Link
            href="/forgot-password"
            className="font-medium text-foreground underline-offset-4 transition-colors hover:text-accent hover:underline"
          >
            Request a new one
          </Link>
        </>
      }
    >
      {isAuthConfigured() ? (
        <UpdatePasswordForm />
      ) : (
        <div className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          Auth is not configured in this environment, so password reset is
          unavailable. Running in single-user dev mode.
        </div>
      )}
    </AuthCard>
  );
}
