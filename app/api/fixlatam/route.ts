import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

// One-off: make sure every stored custom email (gen_body) makes clear the candidates
// are from Latin America. Three cases:
//   - already says "Latin America" -> leave it.
//   - says the "LATAM" shorthand -> spell it out to "Latin America" (clearer to a US buyer).
//   - says neither -> clear gen_subject/gen_body so it falls back to the (fixed) template.
// Auth: ?secret=INGEST_SECRET.
export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const rows = await q<{ id: number; gen_subject: string | null; gen_body: string | null }>(
      `select id, gen_subject, gen_body from leads where gen_body is not null and gen_body <> ''`
    );
    let ok = 0, replaced = 0, cleared = 0;
    for (const r of rows) {
      const body = r.gen_body || "";
      if (/latin america/i.test(body)) { ok++; continue; }
      if (/\bLAT-?AM\b/i.test(body)) {
        const nb = body.replace(/\bLAT-?AM\b/gi, "Latin America");
        const ns = (r.gen_subject || "").replace(/\bLAT-?AM\b/gi, "Latin America");
        await q(`update leads set gen_body = $2, gen_subject = $3, updated_at = now() where id = $1`, [r.id, nb, ns || null]);
        replaced++;
      } else {
        // Mentions neither — fall back to the template (which now states Latin America).
        await q(`update leads set gen_body = null, gen_subject = null, updated_at = now() where id = $1`, [r.id]);
        cleared++;
      }
    }
    return NextResponse.json({ ok: true, total: rows.length, alreadyOk: ok, latamSpelledOut: replaced, clearedToTemplate: cleared });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
