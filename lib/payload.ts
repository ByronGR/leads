import { q } from "./db";

/**
 * THE ONE QUERY that feeds the Command Center.
 *
 * app/page.tsx (initial server render) and app/api/cc (every refresh) used to hold
 * their own hand-maintained copies of this SQL. They had already drifted, and any
 * drift shows up as the page changing its mind about what's due the moment anything
 * is clicked. One source, both callers. (Byron 2026-08-11)
 *
 * NOTE the two paths still deliver different TYPES for date columns — the server
 * component preserves real Date objects through the RSC payload, the API route
 * JSON-stringifies them. lib/cadence.localDate() normalises both; do not assume a
 * string here.
 */
export async function commandCenterData(me: string) {
  const leads = await q(
    `select l.id, l.company, l.owner, l.role, l.contact_name, l.contact_title,
            l.phone, l.email, l.email_confidence, l.status, coalesce(l.sent_count,0) as sent_count,
            l.tz_offset, coalesce(l.dnc,false) as dnc, l.started, l.last_activity,
            l.callback_date, l.callback_time, l.source, l.ab_variant, l.job_url,
            coalesce(l.website, l.domain) as website, l.gen_subject, l.gen_body,
            coalesce(l.opened,false) as opened, l.lead_date,
            coalesce(c.n, 0)::int as call_count, c.last_call_at,
            s.name as sprint_name
     from leads l
     left join lateral (
       select count(*) as n, max(ts) as last_call_at from calls where lead_id = l.id
     ) c on true
     left join lateral (
       select name from sprints
       where start_date <= (case when l.status = 'New' then current_date
                                 else coalesce(l.lead_date, l.last_activity, current_date) end)
       order by start_date desc limit 1
     ) s on true
     order by (l.status = 'New') desc, l.company`
  );

  const activity = await q(
    `select a.id, a.actor, a.action, a.note, a.ts, l.company
     from activity_log a left join leads l on l.id = a.lead_id
     order by a.ts desc limit 50`
  );

  const variants = await q(
    `select case when coalesce(l.gen_subject,'') ~ '(/mo|/month)' then 'C'
                 else coalesce(nullif(l.ab_variant,''),'A') end                   as variant,
            count(*)::int                                                         as leads,
            count(*) filter (where coalesce(l.sent_count,0) > 0)::int             as sent,
            count(*) filter (where l.opened)::int                                 as opened,
            count(*) filter (where l.status in ('Replied','Deal','Won'))::int     as replied
     from leads l where l.status <> 'No' group by 1 order by 1`
  );

  return {
    leads: leads as any,
    activity: activity as any,
    variants: (variants as any[]).map((v) => ({
      ...v,
      reply_rate: v.sent > 0 ? Math.round((v.replied / v.sent) * 1000) / 10 : 0,
      open_rate: v.sent > 0 ? Math.round((v.opened / v.sent) * 1000) / 10 : 0,
    })),
    me,
    generated: new Date().toISOString(),
  };
}
