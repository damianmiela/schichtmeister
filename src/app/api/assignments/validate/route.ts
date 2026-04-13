import { NextRequest, NextResponse } from "next/server";
import { assignmentFailureResponse } from "@/lib/api/assignmentHttp";
import { assignmentValidateBodySchema } from "@/lib/api/assignmentSchemas";
import { parseIsoDateOnly } from "@/lib/api/dateOnly";
import { validateScheduleAssignments } from "@/lib/api/planningScheduleValidation";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import type { AssignmentInput } from "@/lib/planning/types";

/**
 * Dry-run planning rules on a proposed roster (no DB writes).
 * Used by the UI before saving.
 */
export async function POST(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const parsed = await parseJsonBody(request, assignmentValidateBodySchema);
  if (!parsed.ok) return parsed.response;

  const facilityId = session!.user.facilityId;
  const { scheduleId, assignments: rows } = parsed.data;

  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Dienstplan nicht gefunden." }, { status: 404 });
  }

  const inputs: AssignmentInput[] = [];
  for (const r of rows) {
    const d = parseIsoDateOnly(r.date);
    if (!d) {
      return NextResponse.json({ error: "Ungültiges Datum in assignments" }, { status: 400 });
    }
    inputs.push({
      id: r.id,
      date: d,
      shiftProfileId: r.shiftProfileId,
      employeeId: r.employeeId,
    });
  }

  const v = await validateScheduleAssignments(
    prisma,
    facilityId,
    { periodStart: schedule.periodStart, periodEnd: schedule.periodEnd },
    inputs,
  );

  if (!v.ok) {
    return assignmentFailureResponse({
      kind: "http",
      status: v.status,
      error: v.error,
    });
  }

  return NextResponse.json({
    errors: v.result.errors,
    warnings: v.result.warnings,
  });
}
