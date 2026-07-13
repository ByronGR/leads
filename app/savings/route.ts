import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public (outside the team login). The generic /savings link → your calculator.
// Per-lead tracked links live at /savings/[code].
export const CALCULATOR_URL =
  "https://www.nearwork.co/services/direct-recruiting#salary-intelligence";

export async function GET() {
  return NextResponse.redirect(CALCULATOR_URL, 302);
}
