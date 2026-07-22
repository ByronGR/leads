import { NextResponse } from "next/server";
import { q } from "@/lib/db";

// POST /api/apply-copy — narrowly update ONLY the message copy + A/B variant for
// existing leads, matched by company (case/punctuation-insensitive). Used to apply
// the frozen Outreach Spec v1 to leads already in the app WITHOUT touching
// status / owner / opens / why_now / etc. (the generic /api/ingest overwrites some
// of those unconditionally, which would clobber real state). Header: x-ingest-secret.
export async function POST(req: Request) {
  if (req.headers.get("x-ingest-secret") !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { updates } = await req.json();
    let matched = 0;
    for (const u of updates || []) {
      if (!u.company) continue;
      const norm = String(u.company).toLowerCase().replace(/[^a-z0-9]/g, "");
      const r = await q<{ id: number }>(
        `update leads set
           gen_subject = coalesce($2, gen_subject),
           gen_body    = coalesce($3, gen_body),
           ab_variant  = coalesce($4, ab_variant),
           updated_at  = now()
         where lower(regexp_replace(company, '[^a-zA-Z0-9]', '', 'g')) = $1
         returning id`,
        [norm, u.gen_subject ?? null, u.gen_body ?? null, u.ab_variant ?? null]
      );
      if (r.length) matched += r.length;
    }
    return NextResponse.json({ ok: true, matched });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
