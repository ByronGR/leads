import { withAuth } from "next-auth/middleware";

// Require a signed-in @nearwork.co session for the dashboard and the read/write
// leads API. The daily push (/api/ingest) and one-time /api/setup stay open —
// they authenticate with the x-ingest-secret / ?secret instead, so the routine
// (no browser session) can still write.
export default withAuth({
  pages: { signIn: "/signin" },
});

export const config = {
  matcher: ["/", "/api/leads/:path*"],
};
