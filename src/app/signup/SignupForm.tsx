"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  action: (formData: FormData) => Promise<{ error: string } | undefined>;
}

export function SignupForm({ action }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);

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
        setSuccess(true);
      }
    } finally {
      setPending(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-md border-l-2 border-l-accent bg-accent/5 px-4 py-3.5 text-sm leading-relaxed text-accent">
        Account created. Check your email to confirm, then{" "}
        <a href="/login" className="font-medium underline underline-offset-4">
          sign in
        </a>
        .
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
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
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          placeholder="••••••••"
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Minimum 8 characters
        </p>
      </div>
      {error && (
        <p className="rounded-md border-l-2 border-l-accent bg-accent/5 px-3.5 py-2.5 text-sm leading-relaxed text-accent">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
