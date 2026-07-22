import { NextResponse } from "next/server";
import { q } from "@/lib/db";

// POST /api/ingest — the daily routine pushes new/updated leads here.
// Header: x-ingest-secret. Body: { leads: [...] }.
// Upsert by company. HubSpot is the source of truth for owner + status (whoever
// actually sent the last email owns the lead), EXCEPT when a rep changed that
// field in the app — a manual change sets owner_locked/status_locked and is kept.
export async function POST(req: Request) {
  if (req.headers.get("x-ingest-secret") !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { leads, sprints, delete: toDelete, reset: toReset } = await req.json();
    let deleted = 0;
    for (const name of toDelete || []) {
      if (!name) continue;
      await q(`delete from leads where company = $1`, [name]);
      deleted++;
    }
    // Un-mark: put a lead back to New and hand it to the sync/refresh again.
    for (const name of toReset || []) {
      if (!name) continue;
      await q(`update leads set status='New', sent_count=0, status_locked=false, updated_at=now() where company=$1`, [name]);
    }
    let n = 0;
    for (const l of leads || []) {
      if (!l.company) continue;
      // Resolve to an EXISTING row so we never create a duplicate. Prefer matching by
      // DOMAIN (same company, different name — "Boulevard" vs "Joinblvd"); fall back to
      // case/punctuation-insensitive company name ("Zoo" vs "zoo").
      const dom = String(l.domain || "").toLowerCase().replace(/^www\./, "");
      let company = l.company;
      if (dom && dom.includes(".")) {
        const byDom = await q<{ company: string }>(`select company from leads where lower(domain) = $1 limit 1`, [dom]);
        if (byDom[0]) company = byDom[0].company;
      }
      if (company === l.company) {
        const norm = String(l.company).toLowerCase().replace(/[^a-z0-9]/g, "");
        const existing = await q<{ company: string }>(
          `select company from leads
           where lower(regexp_replace(company, '[^a-zA-Z0-9]', '', 'g')) = $1
           limit 1`,
          [norm]
        );
        company = existing[0]?.company || l.company;
      }
      await q(
        `insert into leads
           (company, domain, owner, role, email, email_confidence, status, sent_count, why_now, job_url, last_activity, opened, opened_at, first_name, contact_name, lead_date, gen_subject, gen_body, source, ab_variant)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         on conflict (company) do update set
           owner            = case when leads.owner_locked then leads.owner
                                   else coalesce(nullif(excluded.owner, ''), leads.owner) end,
           status           = case
                                   when leads.status = 'No' and leads.status_locked then 'No'
                                   when excluded.status in ('Replied','Deal','Won') then excluded.status
                                   when leads.status_locked then leads.status
                                   -- never downgrade an already-contacted lead back to New
                                   when excluded.status = 'New' and leads.status <> 'New' then leads.status
                                   else coalesce(nullif(excluded.status, ''), leads.status) end,
           role             = excluded.role,
           email            = coalesce(nullif(leads.email, ''), excluded.email),
           email_confidence = excluded.email_confidence,
           sent_count       = greatest(leads.sent_count, excluded.sent_count),
           why_now          = excluded.why_now,
           job_url          = excluded.job_url,
           last_activity    = excluded.last_activity,
           opened           = excluded.opened,
           opened_at        = excluded.opened_at,
           first_name       = coalesce(nullif(excluded.first_name, ''), leads.first_name),
           contact_name     = coalesce(nullif(excluded.contact_name, ''), leads.contact_name),
           -- KEEP the original lead_date (first-seen). Re-pulling a company that
           -- reopened a role must NOT re-date it into the current sprint — that
           -- was dragging already-contacted Sprint-1 leads into Sprint 2.
           lead_date        = coalesce(leads.lead_date, excluded.lead_date),
           gen_subject      = coalesce(nullif(excluded.gen_subject, ''), leads.gen_subject),
           gen_body         = coalesce(nullif(excluded.gen_body, ''), leads.gen_body),
           source           = coalesce(nullif(excluded.source, ''), leads.source),
           -- A/B test variant (v1 spec): 'A' | 'B' | 'warm-followup'. HubSpot stays
           -- source of truth for reply/opt-out pulls; this mirrors it in-app.
           ab_variant       = coalesce(nullif(excluded.ab_variant, ''), leads.ab_variant),
           updated_at       = now()`,
        [
          company, l.domain ?? null, l.owner ?? null, l.role ?? null, l.email ?? null,
          l.email_confidence ?? null, l.status || "New", l.sent_count || 0,
          l.why_now ?? null, l.job_url ?? null, l.last_activity ?? null,
          l.opened ?? false, l.opened_at ?? null,
          l.first_name ?? null, l.contact_name ?? null, l.lead_date ?? null,
          l.gen_subject ?? null, l.gen_body ?? null, l.source ?? null,
          l.ab_variant ?? null,
        ]
      );
      n++;
    }
    // Optional: define/update Sprints (sequential campaigns). Upsert by name.
    let s = 0;
    for (const sp of sprints || []) {
      if (!sp.name || !sp.start_date) continue;
      await q(
        `insert into sprints (name, focus, start_date, subject_tpl, body_tpl, steps)
         values ($1,$2,$3,$4,$5,$6::jsonb)
         on conflict (name) do update set
           focus       = excluded.focus,
           start_date  = excluded.start_date,
           subject_tpl = excluded.subject_tpl,
           body_tpl    = excluded.body_tpl,
           steps       = excluded.steps,
           updated_at  = now()`,
        [sp.name, sp.focus ?? null, sp.start_date, sp.subject_tpl ?? null, sp.body_tpl ?? null,
         sp.steps ? JSON.stringify(sp.steps) : null]
      );
      s++;
    }
    return NextResponse.json({ ok: true, ingested: n, sprints: s, deleted });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
