import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

// One-off (2026-07-20): null out gen_subject/gen_body on leads whose stored email
// still carries the retired commodity pitch ("40-60% below", "from Colombia",
// "flat fee", "vetted professionals", "same time zone / fluent English"). With
// gen_body cleared, the app falls back to the CURRENT per-source Sprint templates
// (which no longer contain those claims). Only touches New/Sent leads; leaves the
// routine's fresh per-role emails (which don't match these phrases) intact.
// Auth: ?secret=INGEST_SECRET.
const OLD = [
  "%40-60%%",
  "%vetted professionals from Colombia%",
  "%a single flat fee%",
  "%free replacement within the first 3-6%",
  "%fluent English, and our flat-fee%",
  "%vetted on skills + DISC%",
  "%English-fluent professionals, same time zone%",
];

export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const where = OLD.map((_, i) => `gen_body ilike $${i + 1}`).join(" or ");
    const rows = await q<{ id: number; company: string }>(
      `update leads set gen_subject = null, gen_body = null, updated_at = now()
       where status in ('New','Sent') and gen_body is not null and (${where})
       returning id, company`,
      OLD
    );
    return NextResponse.json({ ok: true, cleared: rows.length, companies: rows.map((r) => r.company) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
