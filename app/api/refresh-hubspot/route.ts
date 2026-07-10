import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE = "https://api.hubapi.com";

type Hit = { touches: number; last: string | null };

// Read the ACTUAL outbound emails logged in HubSpot (the reliable "did we send
// this" signal — num_contacted_notes doesn't update reliably for logged 1:1
// emails). One bulk emails-search, paginated, so it stays fast. Returns two maps
// from recipient address: exact email -> {count,last} and domain -> {count,last}.
async function sentEmailMaps(token: string) {
  const byEmail: Record<string, Hit> = {};
  const byDomain: Record<string, Hit> = {};
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const body: any = {
      filterGroups: [{ filters: [{ propertyName: "hs_email_direction", operator: "IN", values: ["EMAIL", "FORWARDED_EMAIL"] }] }],
      properties: ["hs_email_to_email", "hs_timestamp"],
      sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
      limit: 100,
    };
    if (after) body.after = after;
    const res = await fetch(`${BASE}/crm/v3/objects/emails/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) break;
    const data = await res.json();
    for (const r of data.results || []) {
      const p = r.properties || {};
      const ts: string | null = p.hs_timestamp || null;
      const recips = String(p.hs_email_to_email || "").split(/[;,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      for (const addr of recips) {
        const dom = addr.split("@")[1];
        if (!dom) continue;
        const be = byEmail[addr] || { touches: 0, last: null };
        be.touches++; if (!be.last || (ts && ts > be.last)) be.last = ts; byEmail[addr] = be;
        const bd = byDomain[dom] || { touches: 0, last: null };
        bd.touches++; if (!bd.last || (ts && ts > bd.last)) bd.last = ts; byDomain[dom] = bd;
      }
    }
    after = data.paging?.next?.after;
    if (!after) break;
  }
  return { byEmail, byDomain };
}

// POST /api/refresh-hubspot — pull the contacted/pending signal from HubSpot now
// and update the DB. Auth: a signed-in session (the Refresh button) OR ?secret=
// INGEST_SECRET (for automation). Never lowers a count and never overrides a rep's
// manual/locked status; only promotes New -> Sent when HubSpot shows an email went out.
export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  const session = await getServerSession(authOptions);
  if (!session && secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "HUBSPOT_TOKEN not set in Vercel", updated: 0 }, { status: 200 });
  }
  try {
    const leads = await q<{ id: number; email: string; sent_count: number; status: string; status_locked: boolean }>(
      `select id, email, sent_count, status, status_locked
       from leads
       where email is not null and email <> '' and status <> 'No'`
    );
    if (!leads.length) return NextResponse.json({ ok: true, checked: 0, updated: 0 });

    const { byEmail, byDomain } = await sentEmailMaps(token);

    let updated = 0;
    for (const l of leads) {
      const em = l.email.toLowerCase();
      const dom = (em.split("@")[1] || "");
      const exact = byEmail[em];
      const domain = byDomain[dom];
      // Exact contact = accurate follow-up count; otherwise a company-level send
      // still means "contacted" (count it as 1 touch).
      let hit: Hit = { touches: 0, last: null };
      if (exact && exact.touches > 0) hit = exact;
      else if (domain && domain.touches > 0) hit = { touches: 1, last: domain.last };
      if (hit.touches === 0) continue;

      const promote = !l.status_locked && l.status === "New";
      await q(
        `update leads set
           sent_count    = greatest(sent_count, $2),
           status        = case when $3 then 'Sent' else status end,
           last_activity = greatest(last_activity, $4::date),
           updated_at    = now()
         where id = $1`,
        [l.id, hit.touches, promote, hit.last ? String(hit.last).slice(0, 10) : null]
      );
      updated++;
    }
    return NextResponse.json({ ok: true, checked: leads.length, sends: Object.keys(byEmail).length, updated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
