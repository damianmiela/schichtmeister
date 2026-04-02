import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { parseIsoDateOnly } from "@/lib/api/dateOnly";
import { validateScheduleAssignments } from "@/lib/api/planningScheduleValidation";
import type { AssignmentInput } from "@/lib/planning/types";
import { randomUUID } from "node:crypto";

const checkBodySchema = z.object({
  scheduleId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftProfileId: z.string().min(1),
  employeeId: z.string().min(1),
  /** When replacing, remove this assignment before appending the proposed one. */
  replaceAssignmentId: z.string().optional(),
});

/**
 * Dry-run rule validation for a single proposed assignment.
 * Returns errors + warnings without persisting anything.
 */
export async function POST(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const parsed = await parseJsonBody(request, checkBodySchema);
  if (!parsed.ok) return parsed.response;

  const facilityId = session!.user.facilityId;
  const date = parseIsoDateOnly(parsed.data.date);
  if (!date) {
    return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
  }

  const schedule = await prisma.schedule.findFirst({
    where: { id: parsed.data.scheduleId, facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Dienstplan nicht gefunden." }, { status: 404 });
  }

  const existing = await prisma.assignment.findMany({
    where: { scheduleId: schedule.id },
  });

  let base: AssignmentInput[] = existing.map((a) => ({
    id: a.id,
    date: a.date,
    shiftProfileId: a.shiftProfileId,
    employeeId: a.employeeId,
  }));

  // In replace mode, remove the old assignment first
  if (parsed.data.replaceAssignmentId) {
    base = base.filter((a) => a.id !== parsed.data.replaceAssignmentId);
  }

  const proposed: AssignmentInput[] = [
    ...base,
    {
      id: `pending:${randomUUID()}`,
      date,
      shiftProfileId: parsed.data.shiftProfileId,
      employeeId: parsed.data.employeeId,
    },
  ];

  const v = await validateScheduleAssignments(
    prisma,
    facilityId,
    { periodStart: schedule.periodStart, periodEnd: schedule.periodEnd },
    proposed,
  );

  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: v.status });
  }

  return NextResponse.json({
    errors: v.result.errors,
    warnings: v.result.warnings,
  });
}
