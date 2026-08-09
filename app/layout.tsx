import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import "./cc/command-center.css";
import Providers from "./providers";

// The handoff specifies Poppins. Its CSS reads --font-hanken (the bundle reused
// the old stylesheet), so Poppins is bound to that variable rather than editing
// every rule. Poppins runs visually heavy — 400/500/600 only, no 700/800 default.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-hanken",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nearwork · Leads",
  description: "Live lead dashboard for the Nearwork sales team",
  // Internal-only tool — keep it out of search engines (renders
  // <meta name="robots" content="noindex, nofollow">). See also the
  // X-Robots-Tag header in next.config.mjs and app/robots.ts.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
