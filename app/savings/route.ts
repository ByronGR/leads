import { NextResponse } from "next/server";
import { CALCULATOR_URL } from "@/lib/savings";

export const dynamic = "force-dynamic";

// Public (outside the team login). The generic /savings link → your calculator.
// Per-lead tracked links live at /savings/[code].
export async function GET() {
  return NextResponse.redirect(CALCULATOR_URL, 302);
}
