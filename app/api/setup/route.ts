import { NextResponse } from "next/server";
import { q } from "@/lib/db";

// One-time setup: visit /api/setup?secret=YOUR_INGEST_SECRET once after deploying
// to create the database tables. Safe to run more than once (IF NOT EXISTS).
const SCHEMA = `
create table if not exists leads (
  id serial primary key,
  company text not null unique,
  domain text, owner text, role text, email text, email_confidence text,
  status text default 'New', sent_count int default 0,
  why_now text, job_url text, ab_variant text default 'A',
  last_activity date, source text default 'daily-routine',
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists activity_log (
  id serial primary key,
  lead_id int references leads(id) on delete cascade,
  actor text, action text, note text, ts timestamptz default now()
);
create index if not exists idx_leads_owner on leads(owner);
create index if not exists idx_leads_status on leads(status);
-- A rep's manual change in the app locks that field so the daily HubSpot sync
-- won't overwrite it. Otherwise HubSpot is the source of truth for owner/status.
alter table leads add column if not exists owner_locked boolean default false;
alter table leads add column if not exists status_locked boolean default false;
-- Genuine prospect open (rep batch-prep phantom opens already filtered out upstream).
alter table leads add column if not exists opened boolean default false;
alter table leads add column if not exists opened_at date;
-- Fields for the Sprint copy-paste message + which Sprint a lead falls in (by date).
alter table leads add column if not exists first_name text;
alter table leads add column if not exists contact_name text;
alter table leads add column if not exists lead_date date;
-- Sprints = sequential outreach campaigns. A lead belongs to the sprint whose
-- start_date is the latest one on or before the lead's date. Each sprint holds
-- its own subject/body template (the reach / formatting / CTA being tested).
create table if not exists sprints (
  id serial primary key,
  name text not null unique,
  focus text,
  start_date date not null,
  subject_tpl text,
  body_tpl text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_sprints_start on sprints(start_date);
-- Ordered message sequence for a sprint: [{subject, body}, ...] where index 0 is
-- the first email, index 1 is follow-up 1, etc. The app shows steps[sent_count]
-- so the rep always gets the NEXT message to send, not the one already sent.
alter table sprints add column if not exists steps jsonb;
`;

export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await q(SCHEMA);
    const rows = await q("select count(*)::int as leads from leads");
    return NextResponse.json({ ok: true, message: "Tables ready.", leads: rows[0].leads });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
