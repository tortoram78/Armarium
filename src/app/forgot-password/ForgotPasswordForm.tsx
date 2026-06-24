"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  action: (formData: FormData) => Promise<{ error: string } | undefined>;
}

export function ForgotPasswordForm({ action }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const fd = new FormData(e.currentTarget);
      const result = await action(fd);
      if (result?.error) {
        setError(result.error);
      } else {
        // Neutral confirmation — shown whether or not the account exists.
        setSent(true);
      }
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-sm border-l-2 border-primary bg-primary/10 px-4 py-3 text-sm text-primary">
        If an account exists for that address, a password-reset link is on its way.
        Check your inbox (and spam), then{" "}
        <a href="/login" className="font-medium underline underline-offset-4">
          return to sign in
        </a>
        .
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
        <p className="data-mono text-[0.625rem] uppercase tracking-wide text-muted-foreground">
          We&apos;ll send a reset link to this address
        </p>
      </div>
      {error && (
        <p className="rounded-sm border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending link…" : "Send reset link"}
      </Button>
    </form>
  );
}
