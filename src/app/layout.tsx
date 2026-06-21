import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { NavUser } from "@/components/NavUser";
import { isAuthConfigured, getCurrentUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Armarium",
  description: "A faceted gear closet that reasons about what to pack for a trip.",
};

async function getNavUserEmail(): Promise<string | null> {
  if (!isAuthConfigured()) return null;
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.email ?? null;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const userEmail = await getNavUserEmail();
  const authConfigured = isAuthConfigured();

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
              {authConfigured && <NavUser email={userEmail} />}
            </nav>
          </div>
        </header>
        <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
      </body>
    </html>
  );
}
