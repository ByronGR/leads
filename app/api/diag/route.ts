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
    const sprints = await sprintPerformance();
    const leads = (await leadsWithSprint()).slice(0, 5);
    return NextResponse.json({ sprints, sample_leads: leads });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
