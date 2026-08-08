import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";

// Microsoft (Entra/Azure AD) SSO is the primary login. tenantId pins it to the
// Nearwork org, so only @nearwork.co Microsoft accounts can sign in.
//
// Byron 2026-08-08: the passcode fallback is BACK (it was removed 2026-07-13).
// Reason: Microsoft SSO only works on redirect URIs registered in Entra, so it
// can never work on a Vercel PREVIEW url — which locked Byron out of reviewing
// branch deploys. Email + shared passcode restores access anywhere.
//
// The email is not verified — it identifies WHO is working a lead (rep dot,
// activity log, call attribution), it is not the security boundary. The
// passcode is. Keep APP_PASSCODE strong and rotate it if it ever leaks.
export const authOptions: NextAuthOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.MS_CLIENT_ID || "",
      clientSecret: process.env.MS_CLIENT_SECRET || "",
      tenantId: process.env.MS_TENANT_ID || "",
      authorization: { params: { scope: "openid profile email User.Read" } },
    }),
    CredentialsProvider({
      id: "passcode",
      name: "Email and passcode",
      credentials: {
        email: { label: "Work email", type: "email", placeholder: "you@nearwork.co" },
        passcode: { label: "Passcode", type: "password" },
      },
      async authorize(creds) {
        const expected = process.env.APP_PASSCODE;
        if (!expected) return null;                       // fails closed if unset
        const given = (creds?.passcode || "").toString();
        // constant-time-ish compare so the passcode can't be guessed by timing
        if (given.length !== expected.length) return null;
        let diff = 0;
        for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
        if (diff !== 0) return null;

        const email = (creds?.email || "").toString().trim().toLowerCase();
        if (!email.endsWith("@nearwork.co")) return null; // same org limit as SSO
        // "byron.giraldo@nearwork.co" -> "Byron" — matches the rep names the
        // Command Center colours dots by.
        const first = email.split("@")[0].split(/[._-]/)[0];
        const name = first.charAt(0).toUpperCase() + first.slice(1);
        return { id: email, email, name };
      },
    }),
  ],
  pages: { signIn: "/signin" },
  session: { strategy: "jwt" },
};
