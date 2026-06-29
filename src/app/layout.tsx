import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { NavShell } from "@/components/NavShell";
import { SkinController } from "@/components/SkinController";
import { isAuthConfigured, getUserIdOrGuest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/* ----------------------------------------------------------------
   Fonts — premium outdoor-editorial, loaded at build via next/font/google.

   Fraunces      — refined editorial serif. The display/heading voice:
                   confident, timeless, optical-size-aware (soft "wonk"
                   dialed to 0). Page titles + major headings only.
   Inter         — humanist sans. All readable UI text: body, labels,
                   buttons, nav. Comfortable sizes, generous leading.
   IBM Plex Mono — refined technical mono. ONLY actual numeric specs /
                   measurements, used sparingly (never labels/headings).
   ---------------------------------------------------------------- */
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  // Variable font: load the full weight range + optical-size/soft/wonk axes so the
  // CSS utilities can dial a confident, timeless cut (weight via font-weight, wonk → 0).
  axes: ["opsz", "SOFT", "WONK"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Armarium",
  description: "A faceted gear closet that reasons about what to pack for a trip.",
};

/* Mobile viewport + browser-chrome color matched to the warm paper (light) / espresso (dark) theme, so
   the phone status bar / address bar blend into the app instead of a default white/black band. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f3ec" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1714" },
  ],
};

/* ----------------------------------------------------------------
   No-flash theme init. Runs before first paint (in <head>, before the
   body renders) so the correct theme is on <html> immediately — no flash
   of the wrong palette. Resolution order: stored choice > system pref >
   light. Keep STORAGE_KEY in sync with ThemeToggle.tsx. Hand-rolled and
   dependency-free; <html suppressHydrationWarning> covers the class diff.
   ---------------------------------------------------------------- */
const THEME_INIT_SCRIPT = `(function(){try{var k="armarium-theme";var s=localStorage.getItem(k);var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;

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
  // Guest = auth configured + no session. Used to swap the nav user block for a Log in / Sign up affordance
  // and a subtle sample indicator. (Auth unconfigured/dev → isGuest:false → the chrome is unchanged.)
  const { isGuest } = await getUserIdOrGuest();

  // One editorial light theme. `data-skin` is retained on <html> only so a future dark mode can hook in;
  // it no longer flips aesthetics — every route resolves to the same premium look (see globals.css).
  return (
    <html
      lang="en"
      data-skin="editorial"
      className={`${fraunces.variable} ${inter.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* No-flash theme init — must run before the body paints. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NavShell userEmail={userEmail} authConfigured={authConfigured} isGuest={isGuest} />

        {/* SkinController: a clean route-transition wrapper (gentle cross-fade), no skin flipping. */}
        <SkinController>
          <main className="relative z-10 mx-auto w-full max-w-6xl px-6 py-10 sm:py-14 lg:px-8">
            {children}
          </main>
        </SkinController>
      </body>
    </html>
  );
}
