import { NextResponse } from "next/server";
import { q } from "@/lib/db";

// PATCH /api/leads/:id — a rep updates a lead (status, owner, A/B variant, etc.).
// Every change is written to activity_log for a full audit trail.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const allowed = ["status", "owner", "ab_variant", "email", "email_confidence"];
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const f of allowed) {
      if (f in body) {
        sets.push(`${f} = $${i++}`);
        vals.push(body[f]);
      }
    }
    if (!sets.length) return NextResponse.json({ ok: false, error: "no fields" }, { status: 400 });
    vals.push(params.id);
    await q(`update leads set ${sets.join(", ")}, updated_at = now() where id = $${i}`, vals);
    await q(
      `insert into activity_log (lead_id, actor, action, note) values ($1, $2, $3, $4)`,
      [params.id, body.actor || "web", "update", JSON.stringify(body)]
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
