// Privacy — an honest, plain one-pager. Pure Server Component (no event handlers, no env reads), so it
// renders with zero env and is RSC-safe. Static: there is nothing per-request here.

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — Armarium",
  description: "What Armarium stores, where it goes, and how to export or delete your data.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-10 px-4 py-12 sm:py-16">
      <header className="max-w-xl">
        <p className="eyebrow mb-3 text-accent">Privacy</p>
        <h1 className="display-md text-foreground">What we store, and where it goes</h1>
        <p className="mt-4 text-[0.95rem] leading-relaxed text-muted-foreground">
          Armarium is a tool for keeping your gear closet and planning what to pack. We keep the data
          footprint small and we are direct about what leaves your account.
        </p>
      </header>

      <section className="space-y-8 text-[0.95rem] leading-relaxed text-foreground/90">
        <div className="space-y-2">
          <h2 className="subhead text-base text-foreground">What we store</h2>
          <p className="text-muted-foreground">
            Your gear inventory — the items you add, their names, specifications, photos, notes, tags,
            collections, and the trips you plan. If you have an account, we also store your account
            email address for sign-in. That is the extent of it; we do not build advertising profiles
            and we do not sell your data.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="subhead text-base text-foreground">Where your data goes</h2>
          <p className="text-muted-foreground">
            When you add an item, its name and any specs you provide are sent to{" "}
            <span className="font-medium text-foreground">Anthropic</span> (the Claude API) so the item
            can be classified into the facets that drive packing advice. Your gear data and account email
            are stored with <span className="font-medium text-foreground">Supabase</span>, which handles
            authentication and the database. Those are the only third parties your data touches in the
            course of normal use.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="subhead text-base text-foreground">Export and deletion</h2>
          <p className="text-muted-foreground">
            Your data is yours. You can export your closet as a CSV at any time, and you can permanently
            delete your account and everything in it from the{" "}
            <Link
              href="/settings"
              className="font-medium text-foreground underline-offset-4 transition-colors hover:text-accent hover:underline"
            >
              Account
            </Link>{" "}
            page. Deletion removes your gear, trips, collections, and stored corrections. It cannot be
            undone.
          </p>
        </div>
      </section>

      <p className="border-t border-border pt-6 text-sm text-muted-foreground">
        Questions? See our{" "}
        <Link
          href="/terms"
          className="font-medium text-foreground underline-offset-4 transition-colors hover:text-accent hover:underline"
        >
          Terms
        </Link>
        .
      </p>
    </div>
  );
}
