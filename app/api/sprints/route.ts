import { NextResponse } from "next/server";
import { sprintPerformance } from "@/lib/queries";

export const dynamic = "force-dynamic";

// GET /api/sprints — every sprint with live reply-rate performance. Gated by the
// same @nearwork.co session as the dashboard (see middleware).
export async function GET() {
  try {
    return NextResponse.json(await sprintPerformance());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
