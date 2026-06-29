// Custom 404 — Next renders THIS for an unmatched route, inside the root layout chrome (NavShell stays).
// On-brand with the app's premium outdoor-editorial language (matches error.tsx): a calm editorial card,
// warm paper, refined serif heading — not a raw 404. Pure Server Component: a single <Link> home, no
// event handlers, so it is RSC-safe and reads with zero env.

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <div className="panel elev-soft w-full max-w-md px-7 py-9 text-center sm:px-10 sm:py-10">
        <p className="eyebrow mb-4 text-accent">Off the trail</p>
        <h1 className="display-md text-foreground">We couldn&rsquo;t find that page</h1>
        <p className="mx-auto mt-4 max-w-sm text-[0.95rem] leading-relaxed text-muted-foreground">
          The page you were looking for isn&rsquo;t here — it may have moved, or the link was mistyped.
          Your gear and trips are right where you left them.
        </p>
        <div className="mt-7">
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-[var(--radius)] bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none"
          >
            Back to closet
          </Link>
        </div>
      </div>
    </div>
  );
}
