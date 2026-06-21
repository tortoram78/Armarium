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
    <form action={signOutAction} className="flex items-center gap-2.5">
      {email && (
        <span className="hidden data-mono text-[0.625rem] text-muted-foreground sm:inline">
          {email}
        </span>
      )}
      <button
        type="submit"
        className="label-structural rounded-sm px-2.5 py-1 text-[0.625rem] text-muted-foreground transition-colors duration-150 ease-crisp hover:text-blaze"
      >
        Sign out
      </button>
    </form>
  );
}
