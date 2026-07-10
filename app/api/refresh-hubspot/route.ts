import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE = "https://api.hubapi.com";

// Lightweight "have we contacted this lead, how many times, when" lookup — the
// fast signal the Refresh button needs. Batch-reads up to 100 contacts per call,
// so ~100 leads = 1-2 HubSpot calls (a few seconds). The heavier owner-attribution
// + genuine-open/reply filtering stays on the once-daily Mac sync.
async function contactedByEmail(emails: string[], token: string) {
  const out: Record<string, { touches: number; last: string | null }> = {};
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    const res = await fetch(`${BASE}/crm/v3/objects/contacts/batch/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        idProperty: "email",
        properties: ["email", "num_contacted_notes", "notes_last_contacted"],
        inputs: chunk.map((e) => ({ id: e })),
      }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    for (const r of data.results || []) {
      const p = r.properties || {};
      const em = (p.email || "").toLowerCase();
      if (!em) continue;
      const touches = parseInt(p.num_contacted_notes || "0", 10) || 0;
      out[em] = { touches, last: p.notes_last_contacted || null };
    }
  }
  return out;
}

// POST /api/refresh-hubspot — pull the contacted/pending signal from HubSpot now
// and update the DB. Auth: a signed-in session (the Refresh button) OR ?secret=
// INGEST_SECRET (for automation). Never lowers a count and never overrides a rep's
// manual/locked status; only promotes New -> Sent when HubSpot shows contact.
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
    const emails = Array.from(new Set(leads.map((l) => l.email.toLowerCase())));
    if (!emails.length) return NextResponse.json({ ok: true, checked: 0, updated: 0 });
    const map = await contactedByEmail(emails, token);

    let updated = 0;
    for (const l of leads) {
      const hit = map[l.email.toLowerCase()];
      if (!hit) continue;
      const promote = hit.touches > 0 && !l.status_locked && l.status === "New";
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
    return NextResponse.json({ ok: true, checked: leads.length, matched: Object.keys(map).length, updated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
