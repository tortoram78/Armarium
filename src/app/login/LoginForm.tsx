"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  action: (formData: FormData) => Promise<{ error: string } | undefined>;
  /** Optional same-origin redirect target carried through as a hidden field (the save-wall prefill bridge). */
  next?: string;
}

export function LoginForm({ action, next }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  // Surface the post-reset confirmation when redirected from /update-password.
  // Read from window rather than useSearchParams so this route needs no extra
  // Suspense boundary; the banner is a progressive enhancement either way.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("reset") === "success") {
      setResetDone(true);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const fd = new FormData(e.currentTarget);
      const result = await action(fd);
      if (result?.error) setError(result.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      {resetDone && (
        <p className="rounded-sm border-l-2 border-primary bg-primary/10 px-3 py-2 text-sm text-primary">
          Password updated. Sign in with your new password.
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          placeholder="you@example.com"
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="data-mono text-[0.625rem] uppercase tracking-wide text-muted-foreground underline-offset-4 hover:text-blaze hover:underline"
          >
            Forgot?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
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
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
