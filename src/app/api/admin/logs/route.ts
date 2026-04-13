import { NextRequest, NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { readLogs, getLogUsers, getLogStats } from "@/lib/logging/serverLogger";
import type { LogType } from "@/lib/logging/logTypes";

/**
 * GET /api/admin/logs
 *
 * Query params:
 *   action = "entries" | "users" | "stats"  (default: "entries")
 *   type   = "activity" | "system"          (default: "activity")
 *   startDate = YYYY-MM-DD
 *   endDate   = YYYY-MM-DD
 *   userId    = filter by specific user
 *   eventTypes = comma-separated event types
 *   limit  = number (default 200)
 *   offset = number (default 0)
 */
export async function GET(request: NextRequest) {
  const { error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const params = request.nextUrl.searchParams;
  const action = params.get("action") ?? "entries";
  const logType = (params.get("type") ?? "activity") as LogType;

  if (logType !== "activity" && logType !== "system") {
    return NextResponse.json({ error: "Invalid log type" }, { status: 400 });
  }

  const startDate = params.get("startDate") ?? undefined;
  const endDate = params.get("endDate") ?? undefined;

  if (action === "users") {
    const users = getLogUsers(logType, startDate, endDate);
    return NextResponse.json({ users });
  }

  if (action === "stats") {
    const date = params.get("date") ?? undefined;
    const stats = getLogStats(logType, date);
    return NextResponse.json({ stats });
  }

  // Default: return entries
  const userId = params.get("userId") ?? undefined;
  const eventTypesRaw = params.get("eventTypes");
  const eventTypes = eventTypesRaw ? eventTypesRaw.split(",") : undefined;
  const limit = Math.min(500, Math.max(1, Number(params.get("limit")) || 200));
  const offset = Math.max(0, Number(params.get("offset")) || 0);

  const result = readLogs({
    type: logType,
    startDate,
    endDate,
    userId,
    eventTypes,
    limit,
    offset,
  });

  return NextResponse.json(result);
}
