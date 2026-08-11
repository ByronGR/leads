import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { commandCenterData } from "@/lib/payload";
import CommandCenter from "./CommandCenter";

export const dynamic = "force-dynamic";

/**
 * leads.nearwork.co — the Command Center (Byron 2026-08-08 remodel).
 *
 * Reads the SAME `leads` table the 3 AM routine writes, through the SAME query as
 * /api/cc (lib/payload.ts), so the initial render and every refresh can never
 * disagree about what's due.
 */
export default async function Page() {
  const session = await getServerSession(authOptions);
  const initial = await commandCenterData(session?.user?.name || "Byron");
  return <CommandCenter initial={initial as any} />;
}
