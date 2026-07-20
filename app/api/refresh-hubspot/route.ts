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

// Read each rep's DRAFTS folder for emails with a deferred/scheduled send time
// (PidTagDeferredSendTime, "SystemTime 0x3FEF") — i.e. queued to send later. These
// count as "we've committed to emailing this lead" so it won't be re-sent, but they
// stay provisional: if the schedule is cancelled they revert on the next refresh.
async function scheduledMaps(token: string) {
  const byEmail: Record<string, Hit> = {};
  const byDomain: Record<string, Hit> = {};
  const filt = encodeURIComponent("id eq 'SystemTime 0x3FEF'");
  for (const rep of REP_MAILBOXES) {
    const sender = REP_NAME[rep] || null;
    let url: string | undefined =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(rep)}/mailFolders/drafts/messages` +
      `?$top=100&$select=toRecipients,ccRecipients&$expand=singleValueExtendedProperties($filter=${filt})`;
    for (let page = 0; page < 3 && url; page++) {
      const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) break;
      const data: any = await res.json();
      for (const m of data.value || []) {
        const sv = m.singleValueExtendedProperties || [];
        if (!sv.length) continue;                 // only drafts with a scheduled send time
        const ts: string | null = sv[0]?.value || null;
        for (const r of [...(m.toRecipients || []), ...(m.ccRecipients || [])]) {
          const addr = (r.emailAddress?.address || "").toLowerCase();
          const dom = addr.split("@")[1];
          if (!dom || dom === "nearwork.co") continue;
          bump(byEmail, addr, ts, sender);
          bump(byDomain, dom, ts, sender);
        }
      }
      url = data["@odata.nextLink"];
    }
  }
  return { byEmail, byDomain };
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
    const leads = await q<{ id: number; company: string; domain: string | null; email: string | null; sent_count: number; status: string; status_locked: boolean; owner: string | null; owner_locked: boolean; scheduled: boolean }>(
      `select id, company, domain, email, sent_count, status, status_locked, owner, owner_locked, scheduled
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
    // Source 3: each rep's DRAFTS with a scheduled send time (queued, not yet sent).
    let sentFolders = false;
    let schedByEmail: Record<string, Hit> = {}, schedByDomain: Record<string, Hit> = {};
    const gTok = await graphToken();
    if (gTok) {
      const sf = await sentFolderMaps(gTok);
      if (sf) { sentFolders = true; mergeInto(byEmail, sf.byEmail); mergeInto(byDomain, sf.byDomain); }
      const sc = await scheduledMaps(gTok);
      schedByEmail = sc.byEmail; schedByDomain = sc.byDomain;
    }
    if (!token && !sentFolders) {
      return NextResponse.json({ error: "No source configured: set HUBSPOT_TOKEN and/or Microsoft Graph env vars in Vercel", updated: 0 }, { status: 200 });
    }

    const slugOf = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // Match a lead against a recipient map (exact email → domain → stored domain →
    // company-name slug). Reused for confirmed sends AND scheduled drafts.
    const match = (l: any, byE: Record<string, Hit>, byD: Record<string, Hit>): Hit => {
      const em = (l.email || "").toLowerCase();
      if (em) {
        const dom = em.split("@")[1] || "";
        if (byE[em]?.touches > 0) return byE[em];
        if (byD[dom]?.touches > 0) return { touches: 1, last: byD[dom].last, sender: byD[dom].sender };
        return { touches: 0, last: null };
      }
      const stored = String(l.domain || "").toLowerCase().replace(/^www\./, "");
      if (stored && byD[stored]?.touches > 0) return { touches: 1, last: byD[stored].last, sender: byD[stored].sender };
      const slug = slugOf(l.company);
      if (slug.length >= 4) {
        for (const [dom, h] of Object.entries(byD)) {
          if (h.touches > 0 && slugOf(dom.split(".")[0]) === slug) return { touches: 1, last: h.last, sender: h.sender };
        }
      }
      return { touches: 0, last: null };
    };

    let updated = 0, reassigned = 0, scheduledN = 0, reverted = 0;
    for (const l of leads) {
      const hit = match(l, byEmail, byDomain);          // actually sent (confirmed)
      const sHit = match(l, schedByEmail, schedByDomain); // queued in Drafts (scheduled)

      if (hit.touches === 0 && sHit.touches === 0) {
        // Nothing sent or scheduled. If it was provisionally Sent from a schedule that's
        // now gone (cancelled, never sent), revert it to New. Manual/locked leads untouched.
        if (l.scheduled && l.status === "Sent" && !l.status_locked) {
          await q(`update leads set status = 'New', scheduled = false, updated_at = now() where id = $1`, [l.id]);
          reverted++;
        }
        continue;
      }

      // A pending scheduled draft (first email OR follow-up) flags the lead so it drops
      // out of the "to send / follow-up due" pile — its send date pushes last_activity so
      // it isn't nagged. sent_count only advances on a CONFIRMED send (hit).
      const isScheduled = sHit.touches > 0;
      const promote = !l.status_locked && l.status === "New";
      const sender = hit.sender || sHit.sender || null;
      const newOwner = (sender && !l.owner_locked && sender !== l.owner) ? sender : null;
      if (newOwner) reassigned++;
      // latest relevant date (confirmed send or scheduled send-time)
      const dates = [hit.last, sHit.last].filter(Boolean).map((d) => String(d).slice(0, 10)).sort();
      const lastDate = dates.length ? dates[dates.length - 1] : null;

      await q(
        `update leads set
           sent_count    = greatest(sent_count, $2),
           status        = case when $3 then 'Sent' else status end,
           scheduled     = $6,
           last_activity = greatest(last_activity, $4::date),
           owner         = coalesce($5, owner),
           updated_at    = now()
         where id = $1`,
        [l.id, hit.touches, promote, lastDate, newOwner, isScheduled]
      );
      if (isScheduled) scheduledN++; else updated++;
    }
    return NextResponse.json({ ok: true, checked: leads.length, sends: Object.keys(byEmail).length, updated, reassigned, scheduled: scheduledN, reverted, sentFolders, hubspot: !!token });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
