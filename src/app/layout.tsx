import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Armarium",
  description: "A faceted gear closet that reasons about what to pack for a trip.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
