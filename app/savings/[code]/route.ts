import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { CALCULATOR_URL } from "../route";

export const dynamic = "force-dynamic";

// Per-lead tracked link: /savings/{code}. Logs that this company clicked their
// calculator link (a real buy signal), then redirects to the calculator. Never
// blocks the redirect — if anything fails we still send them through.
const OFFSET = 100000;
export function codeForId(id: number) {
  return (id + OFFSET).toString(36);
}
function idForCode(code: string): number | null {
  const n = parseInt(code, 36) - OFFSET;
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: Request, { params }: { params: { code: string } }) {
  try {
    const id = idForCode(params.code);
    if (id) {
      await q(`update leads set calc_clicked = now(), updated_at = now() where id = $1`, [id]);
    }
  } catch { /* never block the redirect */ }
  return NextResponse.redirect(CALCULATOR_URL, 302);
}
