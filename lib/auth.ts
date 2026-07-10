import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

// Only @nearwork.co Google accounts may sign in. The OAuth consent screen is set
// to "Internal" in Google Cloud (Workspace-only), and we double-check the email
// domain here as defense-in-depth.
export const ALLOWED_DOMAIN = "nearwork.co";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      // hd hint pre-filters the Google account chooser to the Workspace domain.
      authorization: { params: { hd: ALLOWED_DOMAIN, prompt: "select_account" } },
    }),
  ],
  callbacks: {
    async signIn({ profile, user }) {
      const email = ((profile as any)?.email || user?.email || "").toLowerCase();
      const hd = (profile as any)?.hd;
      return email.endsWith(`@${ALLOWED_DOMAIN}`) || hd === ALLOWED_DOMAIN;
    },
    async session({ session, token }) {
      if (session.user && token?.picture) session.user.image = token.picture as string;
      return session;
    },
  },
  pages: { signIn: "/signin" },
  session: { strategy: "jwt" },
};
