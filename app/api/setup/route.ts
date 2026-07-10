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
