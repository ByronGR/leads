import { NextResponse } from "next/server";
import { sourcePerformance } from "@/lib/queries";

export const dynamic = "force-dynamic";

// GET /api/sources — per-lead-source performance (sent / opened / replied / reply
// rate), broken out by sprint so different message versions of the same source can
// be compared. Session-gated like the rest of the dashboard.
export async function GET() {
  try {
    return NextResponse.json(await sourcePerformance());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
