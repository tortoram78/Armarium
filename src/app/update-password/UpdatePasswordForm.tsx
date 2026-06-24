"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const MIN_LENGTH = 8;

/**
 * "ready"   — a recovery session is present; show the new-password form.
 * "checking" — still resolving whether the link produced a session.
 * "invalid" — no recovery session (link expired, already used, or opened
 *             without the token fragment).
 */
type LinkState = "checking" | "ready" | "invalid";

export function UpdatePasswordForm() {
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let settled = false;

    // createBrowserClient throws if the public Supabase env was absent at build
    // time (NEXT_PUBLIC_* are inlined then, not read at runtime). Degrade to the
    // invalid-link state instead of a white-screen crash. The server gate
    // (isAuthConfigured) normally prevents mounting this at all in dev mode;
    // this guard covers a build/runtime env mismatch.
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      setLinkState("invalid");
      return;
    }

    // The recovery token lands in the URL fragment; @supabase/ssr's browser
    // client (detectSessionInUrl) parses it and emits PASSWORD_RECOVERY once
    // the session is established.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        settled = true;
        setLinkState("ready");
      }
    });

    // Also check synchronously in case the event fired before this effect
    // attached (e.g. fast hydration) — getSession reads the parsed token.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        settled = true;
        setLinkState("ready");
      } else {
        // Give the URL-fragment parse a beat to land before declaring the
        // link invalid; the listener above flips to "ready" if it succeeds.
        setTimeout(() => {
          if (!settled) setLinkState("invalid");
        }, 1200);
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") ?? "");
    const confirm = String(fd.get("confirm") ?? "");

    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setSuccess(true);
      // Drop the recovery session so a stale tab can't keep mutating the
      // account, then send them to sign in with the new password.
      await supabase.auth.signOut();
      setTimeout(() => {
        window.location.assign("/login?reset=success");
      }, 1400);
    } catch {
      setError("Something went wrong updating your password. Try the reset link again.");
    } finally {
      setPending(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-sm border-l-2 border-primary bg-primary/10 px-4 py-3 text-sm text-primary">
        Password updated. Redirecting you to{" "}
        <a href="/login?reset=success" className="font-medium underline underline-offset-4">
          sign in
        </a>
        …
      </div>
    );
  }

  if (linkState === "checking") {
    return (
      <p className="data-mono py-2 text-center text-[0.625rem] uppercase tracking-wide text-muted-foreground">
        Verifying reset link…
      </p>
    );
  }

  if (linkState === "invalid") {
    return (
      <div className="rounded-sm border-l-2 border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
        This reset link is invalid or has expired. Request a fresh one from{" "}
        <a href="/forgot-password" className="font-medium underline underline-offset-4">
          forgot password
        </a>
        .
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          autoFocus
          required
          placeholder="••••••••"
        />
        <p className="data-mono text-[0.625rem] uppercase tracking-wide text-muted-foreground">
          Minimum {MIN_LENGTH} characters
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          required
          placeholder="••••••••"
        />
      </div>
      {error && (
        <p className="rounded-sm border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
