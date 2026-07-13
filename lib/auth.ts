import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";

// Microsoft (Entra/Azure AD) SSO — the only login (Google removed 2026-07-13, the
// temporary shared-passcode fallback removed 2026-07-13 once Microsoft was confirmed).
// Reuses the "Nearwork Lead Agent" app registration (MS_CLIENT_ID/SECRET/TENANT_ID
// already in Vercel). tenantId pins login to the Nearwork org, so only @nearwork.co
// Microsoft accounts can sign in.
export const authOptions: NextAuthOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.MS_CLIENT_ID || "",
      clientSecret: process.env.MS_CLIENT_SECRET || "",
      tenantId: process.env.MS_TENANT_ID || "",
      authorization: { params: { scope: "openid profile email User.Read" } },
    }),
  ],
  pages: { signIn: "/signin" },
  session: { strategy: "jwt" },
};
