import { q } from "@/lib/db";

// A lead belongs to the sprint whose start_date is the latest on or before the
// lead's date. These two queries are shared by the session-gated API routes and
// the secret-gated /api/diag endpoint so they can never drift apart.

export async function leadsWithSprint() {
  return q(
    `select l.id, l.company, l.owner, l.role, l.email, l.email_confidence, l.status,
            l.sent_count, l.ab_variant, l.why_now, l.job_url, l.last_activity,
            l.opened, l.opened_at, l.first_name, l.contact_name, l.lead_date,
            l.gen_subject, l.gen_body, l.source, l.calc_clicked, l.updated_at, l.scheduled,
            s.name as sprint_name, s.subject_tpl, s.body_tpl, s.steps
     from leads l
     left join lateral (
       select name, subject_tpl, body_tpl, steps
       from sprints
       -- Un-emailed (New) leads always get the CURRENT sprint's copy; already-contacted
       -- leads stay on the sprint that was live when they were first emailed.
       where start_date <= (case when l.status = 'New' then current_date
                                 else coalesce(l.lead_date, l.last_activity, current_date) end)
       order by start_date desc
       limit 1
     ) s on true
     order by (l.status = 'New'), (l.status in ('Sent')), l.company`
  );
}

// Per-SOURCE performance (Byron 2026-07-19): each lead source (active / backlog /
// hard-to-fill / recently-placed / nearshore-switch / latam-list) gets its own
// message, so we need to see how each one performs on its own — and per sprint,
// so different message versions of the same source can be compared.
export async function sourcePerformance() {
  const rows = await q(
    `select coalesce(nullif(l.source, ''), 'unspecified') as source,
            s.name as sprint_name,
            count(*)::int                                                            as leads,
            count(*) filter (where l.status = 'New')::int                            as pending,
            count(*) filter (where coalesce(l.sent_count,0) > 0
                                or l.status in ('Sent','Replied','Deal','Won'))::int as sent,
            count(*) filter (where l.opened)::int                                    as opened,
            count(*) filter (where l.status in ('Replied','Deal','Won'))::int        as replied,
            count(*) filter (where l.status in ('Deal','Won'))::int                  as deals
     from leads l
     left join lateral (
       select name from sprints
       where start_date <= (case when l.status = 'New' then current_date
                                 else coalesce(l.lead_date, l.last_activity, current_date) end)
       order by start_date desc limit 1
     ) s on true
     where l.status <> 'No'
     group by 1, 2
     order by 1, 2 desc`
  );
  return rows.map((r: any) => ({
    ...r,
    reply_rate: r.sent > 0 ? Math.round((r.replied / r.sent) * 1000) / 10 : 0,
    open_rate: r.sent > 0 ? Math.round((r.opened / r.sent) * 1000) / 10 : 0,
  }));
}

export async function sprintPerformance() {
  const rows = await q(
    `with lead_sprint as (
       select l.id, l.status, l.sent_count,
              (select s.id from sprints s
                 where s.start_date <= (case when l.status = 'New' then current_date
                                             else coalesce(l.lead_date, l.last_activity, current_date) end)
                 order by s.start_date desc limit 1) as sprint_id
       from leads l
       where l.status <> 'No'
     )
     select s.id, s.name, s.focus, s.start_date, s.subject_tpl, s.body_tpl, s.steps,
            count(ls.id)::int as leads,
            count(*) filter (where ls.sent_count > 0
                                or ls.status in ('Sent','Replied','Deal','Won'))::int as sent,
            count(*) filter (where ls.status in ('Replied','Deal','Won'))::int as replied
     from sprints s
     left join lead_sprint ls on ls.sprint_id = s.id
     group by s.id, s.name, s.focus, s.start_date, s.subject_tpl, s.body_tpl, s.steps
     order by s.start_date desc`
  );
  return rows.map((r: any) => ({
    ...r,
    reply_rate: r.sent > 0 ? Math.round((r.replied / r.sent) * 1000) / 10 : 0,
  }));
}
