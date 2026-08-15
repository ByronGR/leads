import { q } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * The Command Center's write path. One endpoint, three actions:
 *
 *   call     — append to calls[], stamp called_today, write activity
 *   callback — set the callback date/time (stored in the LEAD's timezone)
 *   sent     — mark an email as sent: bump sent_count, advance the cadence
 *   status   — Replied / No (Not interested)
 *
 * Every action writes an activity_log row so the feed and the rep scoreboard
 * have a single source of truth.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const secret = new URL(req.url).searchParams.get("secret");
  if (!session && secret !== process.env.INGEST_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const actor = session?.user?.name || "Byron";
  const b = await req.json().catch(() => ({}));
  const id = Number(b.lead_id);
  if (!id) return Response.json({ error: "lead_id required" }, { status: 400 });

  const [lead] = await q(`select id, company, sent_count from leads where id = $1`, [id]);
  if (!lead) return Response.json({ error: "no such lead" }, { status: 404 });

  if (b.action === "call") {
    await q(
      `insert into calls (lead_id, actor, outcome, spoke_to, interest, objection,
                          duration_sec, notes, next_step, next_step_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, actor, b.outcome || null, b.spoke_to || null, b.interest || null,
       b.objection || null, b.duration_sec || null, b.notes || null,
       b.next_step || null, b.next_step_date || null]
    );
    await q(`update leads set called_today = true, updated_at = now() where id = $1`, [id]);
    await q(
      `insert into activity_log (lead_id, actor, action, note) values ($1,$2,'call',$3)`,
      [id, actor, `${b.outcome || "Call"}${b.interest ? ` · ${b.interest}` : ""}`]
    );
    // A connected call that lands as interested is a reply in pipeline terms.
    if (b.interest === "Hot") {
      await q(`update leads set status = 'Replied' where id = $1 and status not in ('Deal','Won')`, [id]);
    }
  } else if (b.action === "linkedin") {
    // Byron 2026-08-13: email is paused while nearwork.co recovers, so LinkedIn is
    // the outreach channel. Without its own action the page would keep insisting on
    // an email he has decided not to send, and the follow-up clock would never move.
    // `stage` is "connect" (request sent) or "message" (sent after they accepted).
    const stage = b.stage === "message" ? "message" : "connect";
    await q(
      `update leads
          set linkedin_stage = $2,
              linkedin_at    = current_date,
              last_activity  = current_date,
              started        = coalesce(started, current_date),
              status         = case when status = 'New' then 'Sent' else status end,
              sent_count     = case when $2 = 'message' then greatest(coalesce(sent_count,0), 1)
                                    else coalesce(sent_count,0) end,
              updated_at     = now()
        where id = $1`,
      [id, stage]
    );
    await q(
      `insert into activity_log (lead_id, actor, action, note) values ($1,$2,'linkedin',$3)`,
      [id, actor, stage === "connect" ? "connection request sent" : "LinkedIn message sent"]
    );
  } else if (b.action === "callback") {
    await q(
      `update leads set callback_date = $2, callback_time = $3, updated_at = now() where id = $1`,
      [id, b.callback_date || null, b.callback_time || null]
    );
    await q(
      `insert into activity_log (lead_id, actor, action, note) values ($1,$2,'callback',$3)`,
      [id, actor, `Callback ${b.callback_date || ""} ${b.callback_time || ""}`.trim()]
    );
  } else if (b.action === "sent") {
    await q(
      `update leads
          set sent_count = coalesce(sent_count,0) + 1,
              status = case when status = 'New' then 'Sent' else status end,
              started = coalesce(started, current_date),
              last_activity = current_date,
              updated_at = now()
        where id = $1`,
      [id]
    );
    await q(
      `insert into activity_log (lead_id, actor, action, note) values ($1,$2,'email',$3)`,
      [id, actor, `Email ${(lead.sent_count || 0) + 1} sent`]
    );
  } else if (b.action === "status") {
    const s = String(b.status || "");
    if (!["Replied", "No", "Sent", "New"].includes(s)) {
      return Response.json({ error: "bad status" }, { status: 400 });
    }
    await q(`update leads set status = $2, status_locked = true, updated_at = now() where id = $1`, [id, s]);
    await q(
      `insert into activity_log (lead_id, actor, action, note) values ($1,$2,'status',$3)`,
      [id, actor, s === "No" ? "Not interested" : s]
    );
  } else {
    return Response.json({ error: "unknown action" }, { status: 400 });
  }

  const [row] = await q(
    `select l.*, coalesce(c.n,0)::int as call_count, c.last_call_at
     from leads l left join lateral (
       select count(*) n, max(ts) last_call_at from calls where lead_id = l.id
     ) c on true where l.id = $1`,
    [id]
  );
  return Response.json({ ok: true, lead: row });
}
