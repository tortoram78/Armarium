// Guest funnel banner — the "you're browsing a sample" notice + the Log in / Sign up CTA.
//
// Rendered above the closet (and reused on any guest-facing read surface) when `getUserIdOrGuest()`
// resolves `isGuest`. Pure presentation: two Links, no interactivity, so a plain Server Component. The
// real save wall lives in the server actions (requireUserId); this banner is the invitation, not the gate.

import Link from "next/link";

interface Props {
  /** Optional `?next=` target so login returns the visitor to where they were. */
  next?: string;
  /** Override the headline copy for context (e.g. the preview surface). */
  message?: string;
}

export function GuestBanner({
  next,
  message = "You're viewing a sample closet — log in to build your own.",
}: Props) {
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
  const signupHref = next ? `/signup?next=${encodeURIComponent(next)}` : "/signup";

  return (
    <div className="panel flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-l-2 border-l-accent p-5">
      <div className="min-w-0">
        <p className="eyebrow mb-1.5 text-accent">Sample closet</p>
        <p className="text-[0.95rem] font-medium text-foreground">{message}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse and plan freely — saving requires an account.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <Link
          href={loginHref}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors duration-200 ease-crisp hover:bg-secondary"
        >
          Log in
        </Link>
        <Link
          href={signupHref}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))] transition-colors duration-200 ease-crisp hover:bg-primary/92"
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}
