import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { commandCenterData } from "@/lib/payload";

export const dynamic = "force-dynamic";

/**
 * Everything the Command Center renders, in one call. Shares lib/payload.ts with the
 * server render so a refresh returns exactly what the initial load did.
 *
 * Session-gated; `?secret=` is accepted so the routine and diagnostics can read it
 * headlessly.
 */
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  let me = "Byron";
  if (secret !== process.env.INGEST_SECRET) {
    const session = await getServerSession(authOptions);
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
    me = session.user?.name || "Byron";
  }
  return Response.json(await commandCenterData(me));
}
