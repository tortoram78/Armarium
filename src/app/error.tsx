"use client";

// Route-segment error boundary (ops-hardening wave B2). Next renders THIS in place of a thrown render
// error for the segment, INSIDE the root layout chrome (NavShell stays). `reset()` re-renders the segment
// — it is an event handler, so this MUST be a client component (a Server Component with an onClick prop
// builds but 500s at render: the RSC lesson). The skin matches the app's premium outdoor-editorial
// language — a calm editorial card, warm paper, refined serif heading — not a raw 500 or a tactical plate.

import { useEffect } from "react";
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
      <div className="panel elev-soft w-full max-w-md px-7 py-9 text-center sm:px-10 sm:py-10">
        <p className="eyebrow mb-4 text-accent">Something interrupted</p>
        <h1 className="display-md text-foreground">Something went wrong</h1>
        <p className="mx-auto mt-4 max-w-sm text-[0.95rem] leading-relaxed text-muted-foreground">
          We hit a snag rendering this view. Your gear and trips are safe — try again, and if it keeps
          happening, head back to the closet.
        </p>
        {error.digest ? (
          <p className="mt-4 text-xs text-muted-foreground/70">
            Reference <span className="data-mono text-muted-foreground">{error.digest}</span>
          </p>
        ) : null}
        <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <Button onClick={() => reset()}>Try again</Button>
          <Button variant="outline" onClick={() => (window.location.href = "/")}>
            Back to closet
          </Button>
        </div>
      </div>
    </div>
  );
}
