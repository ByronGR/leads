import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/leads — all leads, engaged first then alphabetical.
export async function GET() {
  try {
    const rows = await q(
      `select id, company, owner, role, email, email_confidence, status,
              sent_count, ab_variant, why_now, job_url, last_activity
       from leads
       order by (status = 'New'), (status in ('Sent')), company`
    );
    return NextResponse.json(rows);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
