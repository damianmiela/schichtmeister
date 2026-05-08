import { NextRequest, NextResponse } from "next/server";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

/**
 * Warnings stored in DB as JSON. Two shapes are accepted for backward
 * compatibility:
 *   - new (current):  Array<{ message: string; count: number }>
 *   - legacy:         Array<string>          → wrapped as { message, count: 1 }
 */
function parseWarnings(json: string | null): { message: string; count: number }[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const out: { message: string; count: number }[] = [];
    for (const item of parsed) {
      if (typeof item === "string") {
        out.push({ message: item, count: 1 });
      } else if (
        item && typeof item === "object" &&
        typeof item.message === "string" &&
        typeof item.count === "number" &&
        item.count >= 0
      ) {
        out.push({ message: item.message, count: item.count });
      }
    }
    return out;
  } catch {
    return [];
  }
}

type PreGenWishesPayload = {
  shiftWishes: { employeeId: string; date: string }[];
  freiDates: { employeeId: string; date: string }[];
  savedEntries?: unknown[];
};

function parsePreGenWishes(json: string | null): PreGenWishesPayload | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object") {
      return {
        shiftWishes: Array.isArray(parsed.shiftWishes) ? parsed.shiftWishes : [],
        freiDates: Array.isArray(parsed.freiDates) ? parsed.freiDates : [],
        savedEntries: Array.isArray(parsed.savedEntries) ? parsed.savedEntries : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export type VirtualPlacement = "1" | "2" | "3" | "NIGHT";

function parseVirtualPlacements(json: string | null): Record<string, VirtualPlacement> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, VirtualPlacement> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && (v === "1" || v === "2" || v === "3" || v === "NIGHT")) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function serializeSchedule(s: {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  warningsJson: string | null;
  preGenWishesJson?: string | null;
  virtualPlacementsJson?: string | null;
  currentVersionId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    periodStart: toIsoDateOnly(s.periodStart),
    periodEnd: toIsoDateOnly(s.periodEnd),
    warnings: parseWarnings(s.warningsJson),
    preGenWishes: parsePreGenWishes(s.preGenWishesJson ?? null),
    virtualPlacements: parseVirtualPlacements(s.virtualPlacementsJson ?? null),
    currentVersionId: s.currentVersionId ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function serializeAssignment(a: {
  id: string;
  scheduleId: string;
  date: Date;
  shiftProfileId: string | null;
  employeeId: string;
  stationNumber: number | null;
  markingRow2: string | null;
  markingRow3: string | null;
  dayStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: a.id,
    scheduleId: a.scheduleId,
    date: toIsoDateOnly(a.date),
    shiftProfileId: a.shiftProfileId,
    employeeId: a.employeeId,
    stationNumber: a.stationNumber ?? null,
    markingRow2: a.markingRow2 ?? null,
    markingRow3: a.markingRow3 ?? null,
    dayStatus: a.dayStatus ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const schedule = await prisma.schedule.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const include = request.nextUrl.searchParams.get("include") ?? "";
  const withAssignments = include.split(",").map((s) => s.trim()).includes("assignments");

  const body: Record<string, unknown> = { schedule: serializeSchedule(schedule) };

  if (withAssignments) {
    const assignments = await prisma.assignment.findMany({
      where: { scheduleId: id },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    body.assignments = assignments.map(serializeAssignment);
  }

  return NextResponse.json(body);
}

/** PATCH — save pre-gen entries for this schedule */
export async function PATCH(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const schedule = await prisma.schedule.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const body = await request.json();
  const savedEntries = Array.isArray(body?.savedEntries) ? body.savedEntries : [];

  // Merge with existing preGenWishes (keep shiftWishes/freiDates intact)
  const existing = parsePreGenWishes(schedule.preGenWishesJson ?? null);
  const merged = {
    shiftWishes: existing?.shiftWishes ?? [],
    freiDates: existing?.freiDates ?? [],
    savedEntries,
  };

  await prisma.schedule.update({
    where: { id },
    data: { preGenWishesJson: JSON.stringify(merged) },
  });

  return NextResponse.json({ ok: true, savedEntries: savedEntries.length });
}
