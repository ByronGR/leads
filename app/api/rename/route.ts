import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

// Correct company-name spelling in place. Body: { map: { "oldname": "New Name", ... } }.
// Matches case/punctuation-insensitively so "coderabbit" -> "CodeRabbit" works.
// Skips a rename if a DIFFERENT row already holds the target name (avoids dupes).
// Auth: ?secret=INGEST_SECRET.
const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { map } = await req.json();
    let renamed = 0, merged = 0;
    for (const [oldName, newName] of Object.entries(map || {})) {
      const nn = String(newName || "").trim();
      if (!oldName || !nn) continue;
      // rows currently under the old (lowercase) spelling
      const rows = await q<{ id: number; company: string }>(
        `select id, company from leads
         where lower(regexp_replace(company,'[^a-zA-Z0-9]','','g')) = $1 and company <> $2`,
        [norm(oldName), nn]
      );
      if (!rows.length) continue;
      // does a row already hold the corrected name?
      const existing = await q<{ id: number }>(`select id from leads where company = $1 limit 1`, [nn]);
      for (const r of rows) {
        if (existing[0]) {
          // proper-named row already exists → drop this lowercase duplicate
          await q(`delete from leads where id = $1`, [r.id]);
          merged++;
        } else {
          await q(`update leads set company = $2, updated_at = now() where id = $1`, [r.id, nn]);
          renamed++;
        }
      }
    }
    return NextResponse.json({ ok: true, renamed, merged });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
