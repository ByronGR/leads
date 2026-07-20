import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE = "https://api.hubapi.com";

// Which rep each mailbox / from-address belongs to — used to set the OWNER to
// whoever actually sent the most recent email (they do the follow-up).
const REP_NAME: Record<string, string> = {
  "byron.giraldo@nearwork.co": "Byron",
  "stephany.picos@nearwork.co": "Stephany",
  "nany.guerra@nearwork.co": "Nany",
  "daniela.jessurum@nearwork.co": "Dani",
};

type Hit = { touches: number; last: string | null; sender?: string | null };

function bump(map: Record<string, Hit>, key: string, ts: string | null, sender: string | null) {
  const h = map[key] || { touches: 0, last: null, sender: null };
  h.touches++;
  if (!h.last || (ts && ts > h.last)) { h.last = ts; if (sender) h.sender = sender; }
  map[key] = h;
}

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
      properties: ["hs_email_to_email", "hs_email_from_email", "hs_timestamp"],
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
      const sender = REP_NAME[String(p.hs_email_from_email || "").toLowerCase()] || null;
      const recips = String(p.hs_email_to_email || "").split(/[;,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      for (const addr of recips) {
        const dom = addr.split("@")[1];
        if (!dom) continue;
        bump(byEmail, addr, ts, sender);
        bump(byDomain, dom, ts, sender);
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
    const sender = REP_NAME[rep] || null; // the mailbox owner = who sent it
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
          bump(byEmail, addr, ts, sender);
          bump(byDomain, dom, ts, sender);
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
    if (!b) { base[k] = { touches: v.touches, last: v.last, sender: v.sender }; continue; }
    b.touches = Math.max(b.touches, v.touches);
    // keep the sender of whichever source has the more recent send
    if (v.last && (!b.last || v.last > b.last)) { b.last = v.last; b.sender = v.sender; }
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
    const leads = await q<{ id: number; company: string; email: string | null; sent_count: number; status: string; status_locked: boolean; owner: string | null; owner_locked: boolean }>(
      `select id, company, domain, email, sent_count, status, status_locked, owner, owner_locked
       from leads
       where status in ('New','Sent')`
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

    const slugOf = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    let updated = 0, reassigned = 0;
    for (const l of leads) {
      const em = (l.email || "").toLowerCase();
      let hit: Hit = { touches: 0, last: null };
      if (em) {
        const dom = em.split("@")[1] || "";
        const exact = byEmail[em];
        const domain = byDomain[dom];
        // Exact contact = accurate follow-up count; otherwise a company-level send
        // still means "contacted" (count it as 1 touch).
        if (exact && exact.touches > 0) hit = exact;
        else if (domain && domain.touches > 0) hit = { touches: 1, last: domain.last, sender: domain.sender };
      } else {
        // No email on the lead. First try the stored domain (catches "Boulevard" whose
        // domain is joinblvd.com); then fall back to matching the company NAME against
        // the domains we emailed (e.g. "RF-SMART" ↔ rfsmart.com).
        const stored = String((l as any).domain || "").toLowerCase().replace(/^www\./, "");
        const byStored = stored ? byDomain[stored] : undefined;
        if (byStored && byStored.touches > 0) hit = { touches: 1, last: byStored.last, sender: byStored.sender };
        else {
          const slug = slugOf(l.company);
          if (slug.length >= 4) {
            for (const [dom, h] of Object.entries(byDomain)) {
              if (h.touches > 0 && slugOf(dom.split(".")[0]) === slug) { hit = { touches: 1, last: h.last, sender: h.sender }; break; }
            }
          }
        }
      }
      if (hit.touches === 0) continue;

      const promote = !l.status_locked && l.status === "New";
      // OWNER = whoever actually sent the most recent email. Skip if a rep manually
      // reassigned this lead (owner_locked) or the sender is already the owner.
      const newOwner = (hit.sender && !l.owner_locked && hit.sender !== l.owner) ? hit.sender : null;
      if (newOwner) reassigned++;
      await q(
        `update leads set
           sent_count    = greatest(sent_count, $2),
           status        = case when $3 then 'Sent' else status end,
           last_activity = greatest(last_activity, $4::date),
           owner         = coalesce($5, owner),
           updated_at    = now()
         where id = $1`,
        [l.id, hit.touches, promote, hit.last ? String(hit.last).slice(0, 10) : null, newOwner]
      );
      updated++;
    }
    return NextResponse.json({ ok: true, checked: leads.length, sends: Object.keys(byEmail).length, updated, reassigned, sentFolders, hubspot: !!token });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
