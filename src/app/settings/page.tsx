// Account settings (TRUST: data ownership). Server Component. The whole destructive surface is gated
// behind isAuthConfigured() so the hermetic zero-env build is byte-for-byte unchanged: in dev/passthrough
// mode there is no real account to manage and no destructive action — we render a short notice instead.
//
// RSC-safe: the only interactivity is a client ConfirmButton inside a <form action={serverAction}>. No
// event-handler props are passed to a Server Component.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ConfirmButton } from "@/components/ConfirmButton";
import { isAuthConfigured, getSessionUser, requireUserId } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Account — Armarium",
  description: "Manage your account and delete your data.",
};

// Reads the live request session (Supabase cookies) → always per-request.
export const dynamic = "force-dynamic";

/**
 * INLINE server action: permanently delete the signed-in user's account and ALL their data, then sign
 * out and return to "/".
 *
 * Order matters: requireUserId() (a guest is bounced to /login before any write) → wipe every
 * user_id-scoped row via the repo's deleteAllUserData → best-effort remove the Supabase auth user
 * (only when the service-role key is present) → sign the session out → redirect home. The auth-record
 * removal is DEPLOY-GATED: without SUPABASE_SERVICE_ROLE_KEY we still wipe all data and sign out, and
 * the auth user row (just an email + a now-orphaned id) is left for a deploy-side admin sweep.
 */
async function deleteAccountAction() {
  "use server";
  if (!isAuthConfigured()) {
    // Defense-in-depth: no destructive action in dev/passthrough mode.
    redirect("/");
  }

  const userId = await requireUserId();

  // 1. Wipe every user_id-scoped row this user owns (items, trips, collections, evidence, overrides).
  const { getRepositoryFor } = await import("@/server/services");
  await getRepositoryFor(userId).deleteAllUserData(userId);

  // 2. Best-effort: delete the Supabase Auth user record via a SERVICE-ROLE admin client. This is the
  //    one place the service-role key is used; it never reaches the client (server action only). If the
  //    key is absent (local/CI), we skip it — data is already wiped and the session is signed out below.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRoleKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await admin.auth.admin.deleteUser(userId);
    } catch {
      // Best-effort: the data is already gone. A failed auth-record deletion must not strand the user
      // in a signed-in state, so we swallow and proceed to sign out + redirect.
    }
  }

  // 3. Sign out the current session (clears the auth cookies) and return home.
  const { createClient } = await import("@/lib/supabase/server");
  await createClient().auth.signOut();
  redirect("/");
}

export default async function SettingsPage() {
  // Dev / passthrough (auth NOT configured): there is no real account and no destructive action.
  if (!isAuthConfigured()) {
    return (
      <div className="mx-auto max-w-2xl space-y-8 px-4 py-12 sm:py-16">
        <header className="max-w-xl">
          <p className="eyebrow mb-3 text-accent">Account</p>
          <h1 className="display-md text-foreground">Account</h1>
        </header>
        <div className="panel elev-soft p-6 sm:p-7">
          <p className="text-[0.95rem] leading-relaxed text-muted-foreground">
            Account management is available when authentication is configured. This environment is
            running in single-user mode, so there is no account to manage.
          </p>
        </div>
      </div>
    );
  }

  // Configured: a real session is required to view this page.
  await requireUserId();
  const session = await getSessionUser();
  const email = session?.email ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-10 px-4 py-12 sm:py-16">
      <header className="max-w-xl">
        <p className="eyebrow mb-3 text-accent">Account</p>
        <h1 className="display-md text-foreground">Account</h1>
        <p className="mt-4 text-[0.95rem] leading-relaxed text-muted-foreground">
          Manage your account and your data.
        </p>
      </header>

      {/* Signed-in identity */}
      <section className="panel p-6 sm:p-7">
        <p className="eyebrow mb-2">Signed in as</p>
        <p className="data-mono text-[0.95rem] text-foreground">{email ?? "—"}</p>
      </section>

      {/* Danger zone: delete account + all data */}
      <section className="panel p-6 sm:p-7">
        <h2 className="subhead text-base text-foreground">Delete account &amp; all data</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
          This permanently removes your gear, trips, collections, saved corrections, and your account.
          It cannot be undone. You can export your closet as a CSV first if you want a copy.
        </p>
        <form action={deleteAccountAction} className="mt-5">
          <ConfirmButton
            variant="destructive"
            message="Permanently delete your account and ALL your data? This cannot be undone."
          >
            Delete account &amp; all data
          </ConfirmButton>
        </form>
      </section>
    </div>
  );
}
