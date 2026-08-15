import { q } from "@/lib/db";
export const dynamic = "force-dynamic";

/**
 * Command Center migration. Additive only — every statement is IF NOT EXISTS so it
 * is safe to re-run and cannot disturb the daily routine that writes `leads`.
 *
 * The Command Center is phone-first, but the pipeline has no phone data yet
 * (Apollo credits are exhausted; HubSpot stores none). So `phone` ships nullable
 * and the UI shows "Find number" instead of a Call button until one exists.
 */
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== process.env.INGEST_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // --- lead fields the Command Center needs on top of the existing schema ---
  await q(`alter table leads add column if not exists phone text`);
  // Byron 2026-08-13: LinkedIn is the outreach channel while nearwork.co's email
  // reputation recovers. find_linkedin.py fills this from search.
  await q(`alter table leads add column if not exists linkedin text`);
  await q(`alter table leads add column if not exists linkedin_stage text`);
  await q(`alter table leads add column if not exists linkedin_at date`);
  await q(`alter table leads add column if not exists contact_title text`);
  await q(`alter table leads add column if not exists website text`);
  // Lead's UTC offset, so we can render their local clock and the call window in
  // Bogotá time (the team's zone). Nullable — derived from location when known.
  await q(`alter table leads add column if not exists tz_offset int`);
  await q(`alter table leads add column if not exists dnc boolean default false`);
  await q(`alter table leads add column if not exists started date`);
  await q(`alter table leads add column if not exists callback_date date`);
  await q(`alter table leads add column if not exists callback_time text`);
  await q(`alter table leads add column if not exists called_today boolean default false`);

  // --- call history: one row per attempt, the record the Calls screen writes ---
  await q(`create table if not exists calls (
    id serial primary key,
    lead_id int references leads(id) on delete cascade,
    actor text,
    outcome text,           -- Connected | Voicemail | No answer | Wrong number | Gatekeeper
    spoke_to text,
    interest text,          -- Hot | Warm | Cold
    objection text,
    duration_sec int,
    notes text,
    next_step text,
    next_step_date date,
    ts timestamptz default now()
  )`);
  await q(`create index if not exists idx_calls_lead on calls(lead_id)`);
  await q(`create index if not exists idx_calls_ts on calls(ts desc)`);
  await q(`create index if not exists idx_activity_ts on activity_log(ts desc)`);

  const [{ leads }] = await q(`select count(*)::int as leads from leads`);
  const [{ withphone }] = await q(
    `select count(*)::int as withphone from leads where coalesce(phone,'') <> ''`
  );
  return Response.json({ ok: true, migrated: true, leads, withphone });
}
