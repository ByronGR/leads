import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Last night's routine health, written by push_run_status.py at the end of deliver.sh.
 *
 * Byron 2026-08-10: the emailed workbook used to be the de-facto "the routine ran"
 * signal. Retiring it (item 3) meant a failed 3 AM run left no trace at all until he
 * noticed an empty queue. The page now says so on its own.
 *
 * Single-row table — we only ever care about the most recent run.
 */
async function ensure() {
  await q(`create table if not exists run_status (
             id int primary key default 1,
             run_id text, started timestamptz, finished timestamptz,
             failed_stages int, stages jsonb, received timestamptz default now())`);
}

export async function POST(req: Request) {
  if (req.headers.get("x-ingest-secret") !== process.env.INGEST_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const b = await req.json().catch(() => null);
  if (!b?.run_id) return Response.json({ error: "run_id required" }, { status: 400 });
  await ensure();
  await q(
    `insert into run_status (id, run_id, started, finished, failed_stages, stages, received)
     values (1, $1, $2, $3, $4, $5, now())
     on conflict (id) do update set run_id = excluded.run_id, started = excluded.started,
       finished = excluded.finished, failed_stages = excluded.failed_stages,
       stages = excluded.stages, received = now()`,
    [b.run_id, b.started, b.finished, b.failed_stages ?? 0, JSON.stringify(b.stages ?? [])]
  );
  return Response.json({ ok: true });
}

export async function GET() {
  await ensure();
  const rows = await q(`select * from run_status where id = 1`);
  return Response.json(rows[0] || null);
}
