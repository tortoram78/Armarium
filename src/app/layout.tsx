import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Armarium",
  description: "A faceted gear closet that reasons about what to pack for a trip.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Armarium
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/" className="rounded-md px-3 py-1.5 hover:bg-neutral-100">Closet</Link>
              <Link href="/items/new" className="rounded-md px-3 py-1.5 hover:bg-neutral-100">Add item</Link>
              <Link href="/plan" className="rounded-md px-3 py-1.5 hover:bg-neutral-100">Plan</Link>
              <Link href="/trips" className="rounded-md px-3 py-1.5 hover:bg-neutral-100">Trips</Link>
            </nav>
          </div>
        </header>
        <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
      </body>
    </html>
  );
}
