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
    const { leads, sprints } = await req.json();
    let n = 0;
    for (const l of leads || []) {
      if (!l.company) continue;
      await q(
        `insert into leads
           (company, domain, owner, role, email, email_confidence, status, sent_count, why_now, job_url, last_activity, opened, opened_at, first_name, contact_name, lead_date)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         on conflict (company) do update set
           owner            = case when leads.owner_locked then leads.owner
                                   else coalesce(nullif(excluded.owner, ''), leads.owner) end,
           status           = case when leads.status_locked then leads.status
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
           lead_date        = coalesce(excluded.lead_date, leads.lead_date),
           updated_at       = now()`,
        [
          l.company, l.domain ?? null, l.owner ?? null, l.role ?? null, l.email ?? null,
          l.email_confidence ?? null, l.status || "New", l.sent_count || 0,
          l.why_now ?? null, l.job_url ?? null, l.last_activity ?? null,
          l.opened ?? false, l.opened_at ?? null,
          l.first_name ?? null, l.contact_name ?? null, l.lead_date ?? null,
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
    return NextResponse.json({ ok: true, ingested: n, sprints: s });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
