import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

// TEMPORARY shared-passcode gate (until we move to Microsoft SSO). Google sign-in
// was removed 2026-07-13. One shared password for the whole team, checked against
// the APP_PASSCODE env var (set in Vercel — never in the repo, which is public).
// This is NOT open to the public: without the passcode you can't get in. If
// APP_PASSCODE is unset the gate fails closed (nobody can sign in) by design.
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Passcode",
      credentials: { passcode: { label: "Passcode", type: "password" } },
      async authorize(credentials) {
        const expected = process.env.APP_PASSCODE || "";
        if (expected && credentials?.passcode === expected) {
          return { id: "team", name: "Nearwork", email: "team@nearwork.co" };
        }
        return null;
      },
    }),
  ],
  pages: { signIn: "/signin" },
  session: { strategy: "jwt" },
};
