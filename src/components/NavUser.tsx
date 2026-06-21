"use client";

import { signOutAction } from "@/app/actions";

interface Props {
  email: string | null;
}

/**
 * Nav user control — shows the signed-in email and a sign-out button.
 * Rendered as a client component because it contains an interactive form.
 */
export function NavUser({ email }: Props) {
  return (
    <form action={signOutAction} className="flex items-center gap-2">
      {email && (
        <span className="hidden text-xs text-neutral-500 sm:inline">{email}</span>
      )}
      <button
        type="submit"
        className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
      >
        Sign out
      </button>
    </form>
  );
}
