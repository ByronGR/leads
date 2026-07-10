import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Bump the string on each deploy to confirm which build is live (rollout visibility).
export async function GET() {
  return NextResponse.json({ build: "steps-v24" });
}
