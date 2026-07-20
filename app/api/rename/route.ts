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
    let renamed = 0; const done: string[] = [];
    for (const [oldName, newName] of Object.entries(map || {})) {
      const nn = String(newName || "").trim();
      if (!oldName || !nn || oldName === nn) continue;
      const rows = await q<{ id: number }>(
        `update leads set company = $2, updated_at = now()
         where lower(regexp_replace(company,'[^a-zA-Z0-9]','','g')) = $1
           and company <> $2
         returning id`,
        [norm(oldName), nn]
      );
      if (rows.length) { renamed += rows.length; done.push(`${oldName} → ${nn}`); }
    }
    return NextResponse.json({ ok: true, renamed, done });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
