import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { writeBatch } from "@/lib/logging/serverLogger";
import type { ActivityEvent } from "@/lib/logging/logTypes";

/**
 * POST /api/activity-log
 * Receives a batch of client-side activity events.
 * Enriches each event with the authenticated userId/userName.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ?? "anonymous";
    const userName = session?.user?.name ?? "";

    const body = await request.json();
    if (!Array.isArray(body?.events)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // Enrich events with server-side user info and validate
    const events: ActivityEvent[] = [];
    for (const raw of body.events) {
      if (!raw.type || !raw.ts) continue;
      events.push({
        ...raw,
        userId,
        userName,
      });
    }

    writeBatch("activity", events);

    return NextResponse.json({ ok: true, count: events.length });
  } catch {
    return NextResponse.json({ error: "Log failed" }, { status: 500 });
  }
}
