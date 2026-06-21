import type { Metadata } from "next";
import { Inter, Oswald, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { NavShell } from "@/components/NavShell";
import { SkinController } from "@/components/SkinController";
import { isAuthConfigured } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/* ----------------------------------------------------------------
   Fonts — loaded at build time via next/font/google
   Inter:         base humanist sans (body, weights 400/500/600/700)
   Oswald:        condensed display — structural labels & headings
                  (topo-legend / field-manual section headers)
   JetBrains Mono: technical data face — facet values, counts, specs
                  (reads "instrument readout")
   ---------------------------------------------------------------- */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const oswald = Oswald({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "700"],
});

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

/** Determine the initial skin from the request URL so SSR matches client. */
function getInitialSkin(pathname: string): "rugged" | "refined" {
  if (pathname.startsWith("/login") || pathname.startsWith("/signup")) {
    return "refined";
  }
  return "rugged";
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const userEmail = await getNavUserEmail();
  const authConfigured = isAuthConfigured();

  // Read the request pathname (forwarded by middleware) so initial data-skin
  // matches what SkinController will set on the client — no hydration flash.
  const headersList = headers();
  const pathname = headersList.get("x-armarium-pathname") ?? "/";
  const initialSkin = getInitialSkin(pathname);

  return (
    <html
      lang="en"
      data-skin={initialSkin}
      className={`${inter.variable} ${oswald.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/* NavShell is client-only (uses usePathname for active links + skin-aware chrome) */}
        <NavShell userEmail={userEmail} authConfigured={authConfigured} />

        {/* SkinController: sets data-skin on <html>, wraps page content
            with framer-motion route-change animation */}
        <SkinController>
          <main className="relative z-10 mx-auto max-w-5xl px-6 py-8">
            {children}
          </main>
        </SkinController>
      </body>
    </html>
  );
}
