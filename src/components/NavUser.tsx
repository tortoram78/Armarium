"use client";

import { signOutAction } from "@/app/actions";

interface Props {
  email: string | null;
}

/**
 * Nav user control — shows the signed-in email and a sign-out button.
 * Rendered as a client component because it contains an interactive form.
 * Uses design-token classes so it recolors correctly in both skins.
 */
export function NavUser({ email }: Props) {
  return (
    <form action={signOutAction} className="ml-1 flex items-center gap-2">
      {email && (
        <span className="hidden text-xs text-muted-foreground sm:inline">{email}</span>
      )}
      <button
        type="submit"
        className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        Sign out
      </button>
    </form>
  );
}
