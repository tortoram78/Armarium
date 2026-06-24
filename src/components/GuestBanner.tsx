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
    <div className="hud-brackets surface-bezel relative overflow-hidden p-4 sm:p-5">
      <span className="hud-corner-tr" aria-hidden />
      <span className="hud-corner-bl" aria-hidden />
      {/* blaze left edge marker — reads as an intentional advisory rail, not an error */}
      <span className="absolute inset-y-0 left-0 w-0.5 bg-blaze" aria-hidden />

      <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="hud-pip" aria-hidden />
            <span className="hud-readout text-[0.625rem] tracking-[0.2em] text-blaze">
              Sample&nbsp;·&nbsp;Read-only
            </span>
          </div>
          <p className="text-sm font-medium text-foreground">{message}</p>
          <p className="data-mono mt-1 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
            Browse and plan freely — saving requires an account.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={loginHref}
            className="label-structural surface-bezel text-stamped px-4 py-2 text-[0.6875rem] [background-color:hsl(var(--primary))] [color:hsl(var(--primary-foreground))] transition-[transform,filter] duration-150 ease-crisp hover:brightness-110 active:scale-[0.985]"
          >
            Log in
          </Link>
          <Link
            href={signupHref}
            className="label-structural surface-bezel text-stamped px-4 py-2 text-[0.6875rem] text-foreground transition-[transform,filter] duration-150 ease-crisp hover:brightness-[1.06] active:scale-[0.985]"
          >
            Sign up
          </Link>
        </div>
      </div>
    </div>
  );
}
