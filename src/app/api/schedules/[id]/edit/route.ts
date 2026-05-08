import { NextResponse } from "next/server";
import { parseIsoDateOnly, toIsoDateOnly } from "@/lib/api/dateOnly";
import { plannerJsonErrors } from "@/lib/api/validation";
import { validateScheduleAssignments } from "@/lib/api/planningScheduleValidation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { snapshotCurrentVersion } from "@/lib/schedule/versionSnapshot";
import { formatRuleViolations } from "@/lib/schedule/formatRuleViolations";
import type { AssignmentInput } from "@/lib/planning/types";

type RouteCtx = { params: Promise<{ id: string }> };

type IncomingAssignment = {
  employeeId: string;
  date: string;
  /** Null when the row is a pure absence marker (dayStatus set, no shift). */
  shiftProfileId: string | null;
  markingRow2?: string | null;
  markingRow3?: string | null;
  dayStatus?: string | null;
  stationNumber?: number | null;
};

type IncomingWishes = {
  shiftWishes?: { employeeId: string; date: string }[];
  freiDates?: { employeeId: string; date: string }[];
};

type VirtualPlacement = "1" | "2" | "3" | "NIGHT";

function parseVirtualPlacements(raw: unknown): Record<string, VirtualPlacement> | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object") return {};
  const out: Record<string, VirtualPlacement> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && (v === "1" || v === "2" || v === "3" || v === "NIGHT")) {
      out[k] = v;
    }
  }
  return out;
}

function parseAssignments(raw: unknown): IncomingAssignment[] {
  if (!Array.isArray(raw)) return [];
  const out: IncomingAssignment[] = [];
  for (const item of raw) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.employeeId !== "string" ||
      typeof item.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(item.date)
    ) {
      continue;
    }
    const shiftProfileId =
      typeof item.shiftProfileId === "string" && item.shiftProfileId.length > 0
        ? item.shiftProfileId
        : null;
    const dayStatus = typeof item.dayStatus === "string" ? item.dayStatus : null;
    // A row must carry either a shift profile or a dayStatus; otherwise it's empty
    // (= delete) and should not be persisted.
    if (!shiftProfileId && !dayStatus) continue;
    out.push({
      employeeId: item.employeeId,
      date: item.date,
      shiftProfileId,
      markingRow2: typeof item.markingRow2 === "string" ? item.markingRow2 : null,
      markingRow3: typeof item.markingRow3 === "string" ? item.markingRow3 : null,
      dayStatus,
      stationNumber: typeof item.stationNumber === "number" ? item.stationNumber : null,
    });
  }
  return out;
}

export async function POST(request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id: scheduleId } = await context.params;
  const facilityId = session!.user.facilityId;
  const userId = session!.user.id;

  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const incoming = parseAssignments(body?.assignments);
  const wishes: IncomingWishes = body?.preGenWishes ?? {};
  const virtualPlacements = parseVirtualPlacements(body?.virtualPlacements);

  const existing = await prisma.assignment.findMany({
    where: { scheduleId },
  });

  const existingByKey = new Map<string, typeof existing[0]>();
  for (const a of existing) {
    existingByKey.set(`${a.employeeId}|${toIsoDateOnly(a.date)}`, a);
  }

  const incomingByKey = new Map<string, IncomingAssignment>();
  for (const a of incoming) {
    incomingByKey.set(`${a.employeeId}|${a.date}`, a);
  }

  const toCreate: IncomingAssignment[] = [];
  const toUpdate: { id: string; shiftProfileId: string | null; markingRow2: string | null; markingRow3: string | null; dayStatus: string | null; stationNumber: number | null }[] = [];
  const toDeleteIds: string[] = [];

  for (const [key, inc] of incomingByKey) {
    const ex = existingByKey.get(key);
    if (!ex) {
      toCreate.push(inc);
    } else if (
      ex.shiftProfileId !== inc.shiftProfileId ||
      (ex.markingRow2 ?? null) !== (inc.markingRow2 ?? null) ||
      (ex.markingRow3 ?? null) !== (inc.markingRow3 ?? null) ||
      (ex.dayStatus ?? null) !== (inc.dayStatus ?? null) ||
      (ex.stationNumber ?? null) !== (inc.stationNumber ?? null)
    ) {
      toUpdate.push({
        id: ex.id,
        shiftProfileId: inc.shiftProfileId,
        markingRow2: inc.markingRow2 ?? null,
        markingRow3: inc.markingRow3 ?? null,
        dayStatus: inc.dayStatus ?? null,
        stationNumber: inc.stationNumber ?? null,
      });
    }
  }

  for (const [key, ex] of existingByKey) {
    if (!incomingByKey.has(key)) {
      toDeleteIds.push(ex.id);
    }
  }

  await prisma.$transaction(async (tx) => {
    // Auto-snapshot current state before editing
    await snapshotCurrentVersion(scheduleId, "Vor Bearbeitung", tx);

    if (toDeleteIds.length > 0) {
      await tx.assignment.deleteMany({
        where: { id: { in: toDeleteIds } },
      });
    }

    for (const u of toUpdate) {
      await tx.assignment.update({
        where: { id: u.id },
        data: {
          shiftProfileId: u.shiftProfileId,
          markingRow2: u.markingRow2,
          markingRow3: u.markingRow3,
          dayStatus: u.dayStatus,
          stationNumber: u.stationNumber,
        },
      });
    }

    if (toCreate.length > 0) {
      await tx.assignment.createMany({
        data: toCreate.map((a) => ({
          scheduleId,
          date: parseIsoDateOnly(a.date)!,
          shiftProfileId: a.shiftProfileId,
          employeeId: a.employeeId,
          markingRow2: a.markingRow2 ?? null,
          markingRow3: a.markingRow3 ?? null,
          dayStatus: a.dayStatus ?? null,
          stationNumber: a.stationNumber ?? null,
          createdByUserId: userId,
        })),
      });
    }

    // Preserve savedEntries from existing preGenWishesJson
    let existingSavedEntries: unknown[] | undefined;
    if (schedule.preGenWishesJson) {
      try {
        const parsed = JSON.parse(schedule.preGenWishesJson);
        if (Array.isArray(parsed?.savedEntries)) existingSavedEntries = parsed.savedEntries;
      } catch { /* ignore */ }
    }
    const preGenObj: Record<string, unknown> = {
      shiftWishes: wishes.shiftWishes ?? [],
      freiDates: wishes.freiDates ?? [],
    };
    if (existingSavedEntries?.length) preGenObj.savedEntries = existingSavedEntries;
    const preGenWishesJson =
      (wishes.shiftWishes?.length ?? 0) > 0 ||
      (wishes.freiDates?.length ?? 0) > 0 ||
      (existingSavedEntries?.length ?? 0) > 0
        ? JSON.stringify(preGenObj)
        : null;

    const scheduleUpdateData: { preGenWishesJson: string | null; virtualPlacementsJson?: string | null } = {
      preGenWishesJson,
    };
    if (virtualPlacements !== undefined) {
      scheduleUpdateData.virtualPlacementsJson =
        Object.keys(virtualPlacements).length > 0 ? JSON.stringify(virtualPlacements) : null;
    }

    await tx.schedule.update({
      where: { id: scheduleId },
      data: scheduleUpdateData,
    });
  });

  const allRows = await prisma.assignment.findMany({
    where: { scheduleId },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  // Status-only rows (no shift profile) are absence markers and are not part of the
  // planning validation domain; skip them so the engine sees only real shifts.
  const assignmentInputs = allRows
    .filter((a) => a.shiftProfileId != null)
    .map((a) => ({
      id: a.id,
      date: a.date,
      shiftProfileId: a.shiftProfileId as string,
      employeeId: a.employeeId,
      ...(a.stationNumber != null && a.stationNumber >= 1 && a.stationNumber <= 3 && { stationNumber: a.stationNumber }),
    })) as AssignmentInput[];

  const v = await validateScheduleAssignments(
    prisma,
    facilityId,
    { periodStart: schedule.periodStart, periodEnd: schedule.periodEnd },
    assignmentInputs,
  );

  let warningStrings: import("@/lib/schedule/formatRuleViolations").FormattedWarning[] = [];
  if (v.ok) {
    const allMessages = [...v.result.errors, ...v.result.warnings];
    if (allMessages.length > 0) {
      const emps = await prisma.employee.findMany({
        where: { facilityId },
        select: { id: true, firstName: true, lastName: true },
      });
      const empNames = new Map(emps.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
      warningStrings = formatRuleViolations(allMessages, empNames);
    }
  }

  await prisma.schedule.update({
    where: { id: scheduleId },
    data: { warningsJson: warningStrings.length > 0 ? JSON.stringify(warningStrings) : null },
  });

  // Snapshot the saved state and mark as current
  await snapshotCurrentVersion(scheduleId, "Manuell bearbeitet", undefined, true);

  return NextResponse.json({
    savedAssignments: allRows.length,
    warnings: warningStrings,
  });
}
