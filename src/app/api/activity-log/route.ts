import { NextRequest, NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requireAuth } from "@/lib/auth/session";
import { writeBatch } from "@/lib/logging/serverLogger";
import type { ActivityEvent } from "@/lib/logging/logTypes";

/** useActivityTracker flushes at most 100 events at a time. */
const MAX_EVENTS_PER_BATCH = 100;
const MAX_BODY_BYTES = 64 * 1024;
/** Per user and hour. A busy planner produces a few dozen page views; the
 *  shared demo login shares one budget, which is fine for a log. */
const MAX_EVENTS_PER_HOUR = 300;
/** Client clocks may be off; further out than this, the server time is used. */
const MAX_CLOCK_SKEW_MS = 60 * 60 * 1000;

// ponytail: in-process counter, same as the generation cancel registry; move to Redis if the app ever runs as several replicas.
const hourlyCount = new Map<string, { hour: number; count: number }>();

/**
 * POST /api/activity-log
 * Receives a batch of page views from useActivityTracker. Only signed-in users
 * may log, only page views are kept, and each user has an hourly budget, so the
 * log files (and the disk) can't be filled from outside.
 */
export async function POST(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return plannerJsonErrors.unauthorized();

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  let raw: unknown;
  try {
    raw = (JSON.parse(text) as { events?: unknown })?.events;
  } catch {
    raw = undefined;
  }
  if (!Array.isArray(raw) || raw.length > MAX_EVENTS_PER_BATCH) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const userId = session!.user.id;
  const userName = session!.user.name ?? "";
  const now = Date.now();
  const events: ActivityEvent[] = [];
  for (const e of raw as Array<Record<string, unknown> | null>) {
    const data = e?.data as { path?: unknown; title?: unknown } | undefined;
    if (e?.type !== "page_view" || typeof data?.path !== "string") continue;
    // The timestamp also names the log file, so it is rebuilt here, never passed through.
    const clientMs = typeof e.ts === "string" ? Date.parse(e.ts) : NaN;
    const ms = Math.abs(clientMs - now) <= MAX_CLOCK_SKEW_MS ? clientMs : now;
    events.push({
      ts: new Date(ms).toISOString(),
      type: "page_view",
      userId,
      userName,
      sessionId: typeof e.sessionId === "string" ? e.sessionId.slice(0, 64) : undefined,
      data: {
        path: data.path.slice(0, 200),
        title: typeof data.title === "string" ? data.title.slice(0, 120) : undefined,
      },
    });
  }

  const hour = Math.floor(now / 3_600_000);
  const counted = hourlyCount.get(userId);
  const used = counted?.hour === hour ? counted.count : 0;
  const kept = events.slice(0, Math.max(0, MAX_EVENTS_PER_HOUR - used));
  hourlyCount.set(userId, { hour, count: used + kept.length });

  writeBatch("activity", kept);
  return NextResponse.json({ ok: true, count: kept.length });
}
