-- Nearwork Leads — database schema (Postgres / Neon / Vercel Postgres)

create table if not exists leads (
  id              serial primary key,
  company         text not null unique,
  domain          text,
  owner           text,
  role            text,
  email           text,
  email_confidence text,
  status          text default 'New',   -- New, Sent, Replied, Deal, Won, No, Unsubscribed
  sent_count      int  default 0,
  why_now         text,
  job_url         text,
  ab_variant      text default 'A',
  last_activity   date,
  source          text default 'daily-routine',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table if not exists activity_log (
  id       serial primary key,
  lead_id  int references leads(id) on delete cascade,
  actor    text,
  action   text,
  note     text,
  ts       timestamptz default now()
);

create index if not exists idx_leads_owner  on leads(owner);
create index if not exists idx_leads_status on leads(status);
