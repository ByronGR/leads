import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { CALCULATOR_URL, idForCode } from "@/lib/savings";

export const dynamic = "force-dynamic";

// Per-lead tracked link: /savings/{code}. Logs that this company clicked their
// calculator link (a real buy signal), then redirects. Never blocks the redirect.
export async function GET(_req: Request, { params }: { params: { code: string } }) {
  try {
    const id = idForCode(params.code);
    if (id) {
      await q(`update leads set calc_clicked = now(), updated_at = now() where id = $1`, [id]);
    }
  } catch { /* never block the redirect */ }
  return NextResponse.redirect(CALCULATOR_URL, 302);
}
