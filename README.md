# Nearwork Leads — leads.nearwork.co

A live web dashboard for the sales team to work leads, replacing the daily Excel/email.
The daily AI routine writes the leads; **this app just reads and serves them — no AI, no tokens.**

- **Framework:** Next.js (App Router) on Vercel
- **Database:** Postgres (Vercel Postgres / Neon)
- **The dashboard:** pipeline table, filter by owner/status, search, A/B toggle, mark-No — all saving to the DB

## Local dev
```bash
npm install
cp .env.example .env.local        # fill in DATABASE_URL + INGEST_SECRET
npm run db:init                   # create the tables
npm run dev                       # http://localhost:3000
```

## Deploy to Vercel
1. Push this repo to GitHub (already connected to https://github.com/ByronGR/leads).
2. In Vercel → **New Project** → import the repo.
3. Add a **Postgres** database (Vercel → Storage → Postgres) — it sets `DATABASE_URL` automatically.
   Add env var **`INGEST_SECRET`** (a long random string).
4. Run the schema once: locally `DATABASE_URL=... npm run db:init`, or paste `db/schema.sql` into the Neon/Vercel SQL console.
5. Deploy. Then **Settings → Domains → add `leads.nearwork.co`** and follow the one DNS record it shows.

## Connect the daily routine (the data source)
Copy `scripts/push_leads.py` into the `nearwork-lead-agent` project and add to the end of `deliver.sh`:
```bash
python3 push_leads.py
```
Set in that project's `.env`:
```
LEADS_APP_URL=https://leads.nearwork.co
INGEST_SECRET=<same value as in Vercel>
```
Now every daily run pushes fresh leads into the app. The upsert **never overwrites** a rep's status or reassigned owner.

## API
- `GET  /api/leads` — all leads
- `PATCH /api/leads/:id` — update status / owner / ab_variant (writes an audit row)
- `POST /api/ingest` — daily push (header `x-ingest-secret`)

## TODO before sharing publicly
- **Add Google sign-in** locked to `@nearwork.co` (NextAuth). Until then the dashboard is open to anyone with the URL — keep it unshared, or add Vercel's password protection in the meantime.

## Roadmap
- Phase 1 (this): dashboard + status/owner/No + A/B toggle — ✅
- Phase 2: A/B results tracking, notes, follow-up scheduling, live multi-user updates
- Phase 3: two-way HubSpot (log/send from the app), unsubscribe writes back to the routine
