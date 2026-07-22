import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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
    <html lang="en" className={hanken.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
