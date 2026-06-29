// Terms — short, truthful "as-is, personal use, no warranty" terms. Pure Server Component (no event
// handlers, no env reads), RSC-safe and renders with zero env. Static.

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms — Armarium",
  description: "Plain terms for using Armarium: personal use, as-is, no warranty.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-10 px-4 py-12 sm:py-16">
      <header className="max-w-xl">
        <p className="eyebrow mb-3 text-accent">Terms</p>
        <h1 className="display-md text-foreground">Terms of use</h1>
        <p className="mt-4 text-[0.95rem] leading-relaxed text-muted-foreground">
          The short version: Armarium is a personal tool, offered as-is. Use it for your own gear and
          trips, and use good judgment about what you pack.
        </p>
      </header>

      <section className="space-y-8 text-[0.95rem] leading-relaxed text-foreground/90">
        <div className="space-y-2">
          <h2 className="subhead text-base text-foreground">Personal use</h2>
          <p className="text-muted-foreground">
            Armarium is intended for personal, non-commercial use to organize your own gear and plan your
            own trips. You are responsible for the content you add and for keeping your account secure.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="subhead text-base text-foreground">Provided as-is</h2>
          <p className="text-muted-foreground">
            The service is provided &ldquo;as is,&rdquo; without warranties of any kind. Packing
            recommendations are generated suggestions, not professional advice — they can be incomplete or
            wrong. For trips where conditions carry real risk, use your own experience and judgment, and
            verify your gear against authoritative sources.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="subhead text-base text-foreground">No liability</h2>
          <p className="text-muted-foreground">
            To the fullest extent permitted by law, Armarium is not liable for any loss or damage arising
            from your use of the service or reliance on its recommendations. You can stop using the
            service and delete your data at any time from the{" "}
            <Link
              href="/settings"
              className="font-medium text-foreground underline-offset-4 transition-colors hover:text-accent hover:underline"
            >
              Account
            </Link>{" "}
            page.
          </p>
        </div>
      </section>

      <p className="border-t border-border pt-6 text-sm text-muted-foreground">
        See also our{" "}
        <Link
          href="/privacy"
          className="font-medium text-foreground underline-offset-4 transition-colors hover:text-accent hover:underline"
        >
          Privacy
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
