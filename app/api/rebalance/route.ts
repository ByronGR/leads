import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

// Evenly distribute un-emailed (New, not manually-assigned) leads across the four
// reps, so nobody is left short. Auth: session OR ?secret=INGEST_SECRET.
// Deterministic (orders by company) so re-running is stable.
const REPS = ["Stephany", "Byron", "Nany", "Dani"];

export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  const session = await getServerSession(authOptions);
  if (!session && secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const rows = await q<{ id: number; owner: string | null }>(
      `select id, owner from leads
       where status = 'New' and coalesce(sent_count,0) = 0
         and not coalesce(owner_locked, false)
       order by company`
    );
    const counts: Record<string, number> = { Stephany: 0, Byron: 0, Nany: 0, Dani: 0 };
    let moved = 0;
    for (let i = 0; i < rows.length; i++) {
      const want = REPS[i % REPS.length];
      counts[want]++;
      if (rows[i].owner !== want) {
        await q(`update leads set owner = $2, updated_at = now() where id = $1`, [rows[i].id, want]);
        moved++;
      }
    }
    return NextResponse.json({ ok: true, total: rows.length, moved, perRep: counts });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
