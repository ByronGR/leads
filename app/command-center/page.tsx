import { q } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import CommandCenter from "./CommandCenter";
import "../cc/tokens.css";
import "../cc/command-center.css";

export const dynamic = "force-dynamic";

/**
 * The Command Center reads the SAME `leads` table the daily routine writes, so
 * what a rep sees is always the live pipeline — no copy, no sync step.
 */
export default async function Page() {
  const session = await getServerSession(authOptions);

  const leads = await q(
    `select l.id, l.company, l.owner, l.role, l.contact_name, l.contact_title,
            l.phone, l.email, l.email_confidence, l.status, coalesce(l.sent_count,0) as sent_count,
            l.tz_offset, coalesce(l.dnc,false) as dnc, l.started, l.last_activity,
            l.callback_date, l.callback_time, l.source, l.ab_variant, l.job_url,
            coalesce(l.website, l.domain) as website, l.gen_subject, l.gen_body,
            coalesce(l.opened,false) as opened,
            coalesce(c.n,0)::int as call_count, c.last_call_at,
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

  return (
    <CommandCenter
      initial={{
        leads: leads as any,
        activity: activity as any,
        variants: (variants as any[]).map((v) => ({
          ...v,
          reply_rate: v.sent > 0 ? Math.round((v.replied / v.sent) * 1000) / 10 : 0,
          open_rate: v.sent > 0 ? Math.round((v.opened / v.sent) * 1000) / 10 : 0,
        })),
        me: session?.user?.name || "Byron",
        generated: new Date().toISOString(),
      }}
    />
  );
}
