import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

// One-off maintenance (2026-07-14). Auth: ?secret=INGEST_SECRET.
//  (1) DEDUPE companies that exist under different casing/spacing ("Zoo" vs "zoo").
//      Keep the most-progressed row, backfill its email/contact from the loser,
//      then delete the loser.
//  (2) FIX DATES: a re-pulled company that reopened a role had its lead_date bumped
//      to today, dragging already-contacted Sprint-1 leads into Sprint 2. Snap each
//      contacted lead's lead_date back to its real last_activity when the date was
//      pushed later than the activity (i.e. it was re-dated, not really re-touched).
const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const RANK: Record<string, number> = { Won: 6, Deal: 5, Replied: 4, No: 3, Sent: 2, New: 1 };

export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const rows = await q<any>(
      `select id, company, domain, status, sent_count, email, contact_name, first_name,
              gen_subject, gen_body, source, owner from leads`
    );
    // Group by DOMAIN when we have one (from the email or the stored domain) — this
    // catches the same company under two different names (e.g. "Boulevard" vs its
    // domain "Joinblvd"). Fall back to the normalized company name otherwise.
    const dedupeKey = (r: any) => {
      const emDom = (r.email || "").toLowerCase().split("@")[1] || "";
      const dom = (emDom || r.domain || "").toLowerCase().replace(/^www\./, "");
      return dom && dom.includes(".") ? "d:" + dom : "c:" + norm(r.company);
    };
    const groups: Record<string, any[]> = {};
    for (const r of rows) (groups[dedupeKey(r)] ||= []).push(r);

    const merged: string[] = [];
    let deleted = 0;
    for (const g of Object.values(groups)) {
      if (g.length < 2) continue;
      g.sort((a, b) =>
        (RANK[b.status] || 0) - (RANK[a.status] || 0) ||
        (b.sent_count || 0) - (a.sent_count || 0) ||
        (b.email ? 1 : 0) - (a.email ? 1 : 0)
      );
      const keep = g[0];
      const losers = g.slice(1);
      // backfill any missing fields on the kept row from the losers
      const patch: Record<string, any> = {};
      for (const f of ["email", "contact_name", "first_name", "gen_subject", "gen_body", "source"]) {
        if (!keep[f]) {
          const donor = losers.find((l) => l[f]);
          if (donor) patch[f] = donor[f];
        }
      }
      if (Object.keys(patch).length) {
        const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 2}`).join(", ");
        await q(`update leads set ${sets}, updated_at = now() where id = $1`, [keep.id, ...Object.values(patch)]);
      }
      for (const l of losers) {
        await q(`delete from leads where id = $1`, [l.id]);
        deleted++;
      }
      merged.push(`${keep.company} (dropped ${losers.map((l) => l.company).join(", ")})`);
    }

    // fix re-dated leads
    const fixed = await q<{ id: number }>(
      `update leads set lead_date = last_activity::date, updated_at = now()
       where status in ('Sent','Replied','Deal','Won')
         and last_activity is not null
         and lead_date is not null
         and lead_date > last_activity::date
       returning id`
    );

    return NextResponse.json({ ok: true, dedupedGroups: merged.length, deleted, merged, reDated: fixed.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
