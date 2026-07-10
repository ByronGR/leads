import { NextResponse } from "next/server";
import { leadsWithSprint, sprintPerformance } from "@/lib/queries";

export const dynamic = "force-dynamic";

// GET /api/diag?secret=INGEST_SECRET — secret-gated read of the same data the
// dashboard shows, for verification/debugging without a browser session. Returns
// sprint performance + a few sample leads (with their Sprint attached).
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const all = await leadsWithSprint();
    const filter = (new URL(req.url).searchParams.get("company") || "").toLowerCase();
    const compact = all
      .filter((l: any) => !filter || (l.company || "").toLowerCase().includes(filter))
      .map((l: any) => ({ company: l.company, owner: l.owner, status: l.status, sent_count: l.sent_count, last_activity: l.last_activity, email: l.email, gen_subject: l.gen_subject, has_gen_body: !!l.gen_body, sprint_name: l.sprint_name, has_steps: !!(l.steps && l.steps.length), has_body_tpl: !!l.body_tpl }));
    const sprints = await sprintPerformance();
    return NextResponse.json({ total: all.length, sprints, leads: compact });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
