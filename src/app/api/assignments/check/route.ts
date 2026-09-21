import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { parseIsoDateOnly } from "@/lib/api/dateOnly";
import { mergePlanningRules } from "@/lib/planning/merge";
import { defaultPlanningRulesConfig } from "@/lib/planning/defaultConfig";
import { registerBuiltInPlanningRules } from "@/lib/planning/registerBuiltInRules";
import { runAllRules } from "@/lib/planning/registry";
import type {
  AbsenceInput,
  AssignmentInput,
  EmployeeInput,
  RuleContext,
  ShiftProfileInput,
  StaffingRequirementInput,
  TargetFilter,
} from "@/lib/planning/types";

const checkBodySchema = z.object({
  scheduleId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftProfileId: z.string().min(1),
  employeeId: z.string().min(1),
  /** When replacing, remove this assignment before appending the proposed one. */
  replaceAssignmentId: z.string().optional(),
});

/**
 * Targeted rule validation for a proposed assignment.
 * Uses the SAME rule engine as month-view validation, but with a
 * targetFilter so rules scope to this employee + day only.
 *
 * Returns errors (hard violations) + warnings (soft violations).
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

  const schedule = await prisma.schedule.findFirst({ where: { id: parsed.data.scheduleId, facilityId } });
  if (!schedule) {
    return NextResponse.json({ error: "Dienstplan nicht gefunden." }, { status: 404 });
  }

  const [facility, employees, allProfiles, allAssignments, staffingRows, absenceRows] =
    await Promise.all([
      prisma.facility.findUnique({ where: { id: facilityId } }),
      prisma.employee.findMany({
        where: { facilityId },
        include: {
          allowedShiftProfiles: { select: { id: true } },
        },
      }),
      prisma.shiftProfile.findMany({ where: { facilityId } }),
      prisma.assignment.findMany({ where: { scheduleId: parsed.data.scheduleId } }),
      prisma.staffingRequirement.findMany({
        where: { facilityId },
        include: { qualificationRequirements: true },
      }),
      prisma.employeeAbsence.findMany({
        where: {
          employee: { facilityId },
          startDate: { lte: schedule.periodEnd },
          endDate: { gte: schedule.periodStart },
        },
      }),
    ]);

  if (!facility) {
    return NextResponse.json({ error: "Einrichtung nicht gefunden." }, { status: 404 });
  }

  const employee = employees.find((e) => e.id === parsed.data.employeeId);
  if (!employee) {
    return NextResponse.json({ error: "Mitarbeiter nicht gefunden." }, { status: 404 });
  }

  const profile = allProfiles.find((p) => p.id === parsed.data.shiftProfileId);
  if (!profile) {
    return NextResponse.json({ error: "Schichtprofil nicht gefunden." }, { status: 404 });
  }

  const snapshot = mergePlanningRules(facility, defaultPlanningRulesConfig);

  // Build employee map with displayName for German messages
  const employeesById = new Map<string, EmployeeInput>();
  for (const e of employees) {
    employeesById.set(e.id, {
      id: e.id,
      contractType: e.contractType,
      miniJobMaxMonthlyHours: e.miniJobMaxMonthlyHours != null ? Number(e.miniJobMaxMonthlyHours) : null,
      qualificationTags: e.qualificationTags,
      targetHoursPercent: e.targetHoursPercent != null ? Number(e.targetHoursPercent) : null,
      allowedShiftProfileIds: e.allowedShiftProfiles.map((p) => p.id),
      maxConsecutiveDays: (e as unknown as { maxConsecutiveDays?: number | null }).maxConsecutiveDays ?? null,
      displayName: `${e.firstName} ${e.lastName}`,
      status: e.status,
    });
  }

  const profilesById = new Map<string, ShiftProfileInput>();
  for (const p of allProfiles) {
    profilesById.set(p.id, {
      id: p.id,
      shiftType: p.shiftType,
      startTime: p.startTime,
      endTime: p.endTime,
      breakMinutes: p.breakMinutes,
    });
  }

  // Build assignments list: existing (minus replaced) + proposed
  let rawAssignments = allAssignments;
  if (parsed.data.replaceAssignmentId) {
    rawAssignments = rawAssignments.filter((a) => a.id !== parsed.data.replaceAssignmentId);
  }

  const assignments: AssignmentInput[] = [
    ...rawAssignments
      .filter((a) => a.shiftProfileId != null)
      .map((a) => ({
        id: a.id,
        date: a.date,
        shiftProfileId: a.shiftProfileId as string,
        employeeId: a.employeeId,
      })),
    // Add the proposed assignment
    {
      id: "__proposed__",
      date,
      shiftProfileId: parsed.data.shiftProfileId,
      employeeId: parsed.data.employeeId,
    },
  ];

  const staffingRequirements: StaffingRequirementInput[] = staffingRows.map((r) => ({
    shiftType: r.shiftType,
    stationNumber: r.stationNumber,
    minTotalCount: r.minTotalCount,
    maxTotalCount: r.maxTotalCount,
    isFacilityWide: r.isFacilityWide,
    qualificationRequirements: r.qualificationRequirements.map((q) => ({
      qualificationTag: q.qualificationTag,
      minCount: q.minCount,
    })),
  }));

  const absences: AbsenceInput[] = absenceRows.map((a) => ({
    employeeId: a.employeeId,
    startDate: a.startDate,
    endDate: a.endDate,
    type: a.type,
  }));

  const targetFilter: TargetFilter = {
    employeeId: parsed.data.employeeId,
    date,
    shiftProfileId: parsed.data.shiftProfileId,
  };

  const ctx: RuleContext = {
    periodStart: schedule.periodStart,
    periodEnd: schedule.periodEnd,
    assignments,
    employeesById,
    profilesById,
    staffingRequirements,
    wishes: [],
    snapshot,
    absences,
    targetFilter,
  };

  registerBuiltInPlanningRules();
  const { errors, warnings } = runAllRules(ctx);

  return NextResponse.json({ errors, warnings });
}
