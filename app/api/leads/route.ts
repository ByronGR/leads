import { NextResponse } from "next/server";
import { leadsWithSprint } from "@/lib/queries";

export const dynamic = "force-dynamic";

// GET /api/leads — all leads with their Sprint + templates, engaged first.
export async function GET() {
  try {
    return NextResponse.json(await leadsWithSprint());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
