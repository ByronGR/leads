import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rule (new + old sprints): if a lead is assigned to a rep and they DON'T email it,
// the next agent run hands it to the next rep in rotation — so un-emailed leads never
// rot with one person. Only touches New (never-emailed) leads created before today,
// and never overrides a manual reassignment (owner_locked).
// Byron 2026-07-19: only Byron & Stephany receive NEW leads. Dani & Nany source
// their own and finish existing follow-ups — those are 'Sent', so untouched here
// (this route only rotates un-emailed New leads).
const REPS = ["Stephany", "Byron"];
const nextRep = (cur: string | null) => REPS[(REPS.indexOf(cur || "") + 1) % REPS.length];

export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  const session = await getServerSession(authOptions);
  if (!session && secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const stale = await q<{ id: number; owner: string | null }>(
      `select id, owner from leads
       where status = 'New' and coalesce(sent_count, 0) = 0
         and not coalesce(owner_locked, false)
         and created_at < current_date`
    );
    let reassigned = 0;
    for (const l of stale) {
      const nw = nextRep(l.owner);
      if (nw !== l.owner) {
        await q(`update leads set owner = $2, updated_at = now() where id = $1`, [l.id, nw]);
        reassigned++;
      }
    }
    return NextResponse.json({ ok: true, checked: stale.length, reassigned });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
