import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";

// Microsoft (Entra/Azure AD) SSO — primary login (added 2026-07-13). Reuses the
// SAME app registration that reads Outlook Sent folders (MS_CLIENT_ID/SECRET/
// TENANT_ID already in Vercel). tenantId pins the login authority to the Nearwork
// org, so only @nearwork.co Microsoft accounts can sign in.
//
// The shared-passcode Credentials provider is kept as a TEMPORARY fallback so the
// team isn't locked out during the Google→Microsoft switch. Remove it once
// Microsoft login is confirmed working for everyone.
const providers: NextAuthOptions["providers"] = [];

if (process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_TENANT_ID) {
  providers.push(
    AzureADProvider({
      clientId: process.env.MS_CLIENT_ID,
      clientSecret: process.env.MS_CLIENT_SECRET,
      tenantId: process.env.MS_TENANT_ID,
      authorization: { params: { scope: "openid profile email User.Read" } },
    })
  );
}

providers.push(
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
  })
);

export const authOptions: NextAuthOptions = {
  providers,
  pages: { signIn: "/signin" },
  session: { strategy: "jwt" },
};
