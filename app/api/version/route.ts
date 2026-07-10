import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Bump on each deploy to confirm which build is live (rollout visibility).
export const BUILD = "steps-v2";

export async function GET() {
  return NextResponse.json({ build: BUILD });
}
