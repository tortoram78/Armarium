"use client";

// Route-segment error boundary (ops-hardening wave B2). Next renders THIS in place of a thrown render
// error for the segment, INSIDE the root layout chrome (NavShell stays). `reset()` re-renders the segment
// — it is an event handler, so this MUST be a client component (a Server Component with an onClick prop
// builds but 500s at render: the RSC lesson). The skin matches the app's tactical instrument plates
// (square machined bezel, milled bevel + cast, HUD registration brackets, ghosted stencil), not a raw 500.

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error to the console so it is captured by the platform log sink. (logEvent is
    // server-only; this boundary runs on the client, so a plain console.error is the right seam here.)
    console.error("route error boundary", error);
  }, [error]);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <div className="hud-brackets surface-bezel relative w-full max-w-md overflow-hidden">
        <span className="hud-corner-tr" aria-hidden />
        <span className="hud-corner-bl" aria-hidden />
        {/* ghosted stencil code behind the header */}
        <span
          className="hud-stencil pointer-events-none absolute -right-1 -top-6 text-[7rem]"
          aria-hidden
        >
          ER
        </span>
        {/* recessed screw at the panel corner (sparing hardware) */}
        <span className="hud-screw absolute right-3 top-3" aria-hidden />

        {/* Header plate — recessed instrument well */}
        <div className="surface-well relative m-3 flex flex-col items-center gap-3 px-8 py-7 text-center">
          <span
            className="surface-bezel flex h-10 w-10 items-center justify-center text-blaze"
            aria-hidden
          >
            <AlertTriangle className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="flex flex-col items-center gap-1.5">
            <h1 className="heading-display text-stamped text-2xl tracking-legend text-foreground">
              Signal lost
            </h1>
            <div className="flex items-center gap-2">
              <span className="hud-pip" aria-hidden />
              <p className="hud-readout text-[0.5625rem] tracking-[0.18em]">
                fault&nbsp;·&nbsp;segment
              </p>
            </div>
          </div>
        </div>

        {/* Body — copy + recover control */}
        <div className="relative px-6 pb-6 pt-1">
          <p className="text-center text-sm text-muted-foreground">
            Something went wrong rendering this view. Your gear and trips are safe — try again, and if it
            keeps happening, head back to the closet.
          </p>
          {error.digest ? (
            <p className="hud-readout mt-3 text-center text-[0.5625rem] tracking-[0.18em] text-muted-foreground/70">
              ref&nbsp;{error.digest}
            </p>
          ) : null}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => reset()}>Try again</Button>
            <Button variant="outline" onClick={() => (window.location.href = "/")}>
              Back to closet
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
