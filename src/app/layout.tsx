import type { Metadata, Viewport } from "next";
// Self-hosted Geist (Vercel's `geist` package) — no build-time Google Fonts
// fetch, so builds work offline / behind a TLS-intercepting proxy. Exposes the
// same --font-geist-sans / --font-geist-mono CSS variables.
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Entice",
  description: "Civil & remediation operations platform",
  appleWebApp: {
    title: "Entice",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#162040",
  // Draw edge-to-edge behind the notch and home indicator. Without this iOS
  // letterboxes a standalone PWA; with it, the shells below must respect
  // env(safe-area-inset-*) or content slides under the system UI.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // Browser extensions (screen recorders, password managers) inject
      // attributes into <html> before React hydrates; suppress attribute
      // mismatch warnings on this element only.
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
