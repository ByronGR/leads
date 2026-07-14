import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

// One-off maintenance (2026-07-14): refresh routine leads whose gen_body still
// carries the OLD pitch. Keeps each lead's personalized first line (extracted from
// the old body) and rebuilds it with the new Sprint 2 wording. Idempotent — once a
// lead is fixed it no longer matches the marker, so re-calling is a no-op.
// Auth: ?secret=INGEST_SECRET.
const OLD_MARKER = "Nearwork places vetted professionals from Colombia";

function newBody(first: string | null, firstLine: string) {
  return (
    `Hi ${first || "there"},\n\n${firstLine ? firstLine + " " : ""}We build you a hire in about 21 days — ` +
    `English-fluent professionals, same time zone, vetted on skills + DISC, at ~65% of a US salary — ` +
    `and you only pay once you've hired.\n\nWorth putting a shortlist together?\n\n` +
    `P.S. — 30-second cost breakdown vs a US hire: nearwork.co/savings`
  );
}

export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const rows = await q<{ id: number; company: string; first_name: string | null; gen_body: string }>(
      `select id, company, first_name, gen_body from leads
       where status = 'New' and gen_body like $1`,
      [`%${OLD_MARKER}%`]
    );
    let fixed = 0, keptLine = 0;
    const touched: string[] = [];
    for (const r of rows) {
      const m = (r.gen_body || "").match(/^Hi\s+[^,\n]*,\s*\n\n([\s\S]*?)\s*Nearwork places vetted professionals/);
      const firstLine = m ? m[1].trim() : "";
      if (m) keptLine++;
      await q(`update leads set gen_body = $2, updated_at = now() where id = $1`, [r.id, newBody(r.first_name, firstLine)]);
      fixed++;
      touched.push(r.company);
    }
    return NextResponse.json({ ok: true, matched: rows.length, fixed, keptFirstLine: keptLine, companies: touched });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
