"use client";

import { signOutAction } from "@/app/actions";

interface Props {
  email: string | null;
}

/**
 * Nav user control — the signed-in email + a sign-out button. Client component
 * (interactive form). Editorial styling so it sits quietly in the masthead.
 */
export function NavUser({ email }: Props) {
  return (
    <form action={signOutAction} className="flex items-center gap-3">
      {email && (
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {email}
        </span>
      )}
      <button
        type="submit"
        className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-200 ease-crisp hover:text-foreground"
      >
        Sign out
      </button>
    </form>
  );
}
