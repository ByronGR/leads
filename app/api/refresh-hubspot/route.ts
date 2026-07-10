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

// Reps' mailboxes we read Sent Items from (the source of truth for "we emailed
// this", independent of whether HubSpot logged it).
const REP_MAILBOXES = [
  "byron.giraldo@nearwork.co",
  "stephany.picos@nearwork.co",
  "nany.guerra@nearwork.co",
  "daniela.jessurum@nearwork.co",
];

async function graphToken(): Promise<string | null> {
  const tenant = process.env.MS_TENANT_ID, id = process.env.MS_CLIENT_ID, secret = process.env.MS_CLIENT_SECRET;
  if (!tenant || !id || !secret) return null;
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  if (!res.ok) return null;
  return (await res.json()).access_token || null;
}

// Read each rep's Outlook Sent Items and build recipient -> {count,last} maps.
// Catches EVERY email sent, even ones HubSpot never logged. Returns null if Graph
// isn't configured or lacks Mail.Read (so the caller falls back to HubSpot only).
async function sentFolderMaps(token: string) {
  const byEmail: Record<string, Hit> = {};
  const byDomain: Record<string, Hit> = {};
  let ok = false;
  for (const rep of REP_MAILBOXES) {
    let url: string | undefined =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(rep)}/mailFolders/SentItems/messages` +
      `?$top=100&$select=toRecipients,ccRecipients,sentDateTime&$orderby=sentDateTime desc`;
    for (let page = 0; page < 3 && url; page++) {
      const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) break;
      ok = true;
      const data: any = await res.json();
      for (const m of data.value || []) {
        const ts: string | null = m.sentDateTime || null;
        const recips = [...(m.toRecipients || []), ...(m.ccRecipients || [])];
        for (const r of recips) {
          const addr = (r.emailAddress?.address || "").toLowerCase();
          const dom = addr.split("@")[1];
          if (!dom || dom === "nearwork.co") continue; // skip internal
          const be = byEmail[addr] || { touches: 0, last: null };
          be.touches++; if (!be.last || (ts && ts > be.last)) be.last = ts; byEmail[addr] = be;
          const bd = byDomain[dom] || { touches: 0, last: null };
          bd.touches++; if (!bd.last || (ts && ts > bd.last)) bd.last = ts; byDomain[dom] = bd;
        }
      }
      url = data["@odata.nextLink"];
    }
  }
  return ok ? { byEmail, byDomain } : null;
}

function mergeInto(base: Record<string, Hit>, add: Record<string, Hit>) {
  for (const [k, v] of Object.entries(add)) {
    const b = base[k];
    if (!b || v.touches > b.touches) base[k] = { touches: Math.max(v.touches, b?.touches || 0), last: (b?.last && b.last > (v.last || "")) ? b.last : v.last };
    else if (v.last && (!b.last || v.last > b.last)) b.last = v.last;
  }
}

// POST /api/refresh-hubspot — pull the contacted/pending signal now and update the
// DB. Reads BOTH HubSpot's logged emails AND each rep's Outlook Sent folder (via
// Microsoft Graph), so a send counts even if HubSpot never logged it. Auth: a
// signed-in session (Refresh button) OR ?secret=INGEST_SECRET. Never lowers a count
// and never overrides a rep's manual/locked status; only promotes New -> Sent.
export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  const session = await getServerSession(authOptions);
  if (!session && secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.HUBSPOT_TOKEN;
  try {
    // Only the COLD sequence (New / Sent). Once a lead replies (Replied/Deal/Won)
    // it's a live conversation — those emails are NOT follow-ups, so we freeze the
    // count and never touch it here. 'No' is excluded too.
    const leads = await q<{ id: number; email: string; sent_count: number; status: string; status_locked: boolean }>(
      `select id, email, sent_count, status, status_locked
       from leads
       where email is not null and email <> '' and status in ('New','Sent')`
    );
    if (!leads.length) return NextResponse.json({ ok: true, checked: 0, updated: 0 });

    // Source 1: emails logged in HubSpot.
    const byEmail: Record<string, Hit> = {};
    const byDomain: Record<string, Hit> = {};
    if (token) {
      const hs = await sentEmailMaps(token);
      mergeInto(byEmail, hs.byEmail); mergeInto(byDomain, hs.byDomain);
    }
    // Source 2: each rep's actual Outlook Sent folder (catches everything).
    let sentFolders = false;
    const gTok = await graphToken();
    if (gTok) {
      const sf = await sentFolderMaps(gTok);
      if (sf) { sentFolders = true; mergeInto(byEmail, sf.byEmail); mergeInto(byDomain, sf.byDomain); }
    }
    if (!token && !sentFolders) {
      return NextResponse.json({ error: "No source configured: set HUBSPOT_TOKEN and/or Microsoft Graph env vars in Vercel", updated: 0 }, { status: 200 });
    }

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
    return NextResponse.json({ ok: true, checked: leads.length, sends: Object.keys(byEmail).length, updated, sentFolders, hubspot: !!token });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
