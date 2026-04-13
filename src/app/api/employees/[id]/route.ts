import { NextRequest, NextResponse } from "next/server";
import { Prisma, ContractType } from "@prisma/client";
import { resolveContractForPatch } from "@/lib/api/employeeContractResolve";
import { employeePatchSchema } from "@/lib/api/employeeSchemas";
import { serializeEmployee } from "@/lib/api/employeeSerialize";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const employeeInclude = {
  workProfile: true,
  qualifications: true,
  allowedShiftProfiles: true,
} as const;

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const employee = await prisma.employee.findFirst({
    where: { id, facilityId: session!.user.facilityId },
    include: employeeInclude,
  });
  if (!employee) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  return NextResponse.json({ employee: serializeEmployee(employee) });
}

export async function PATCH(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const facilityId = session!.user.facilityId;
  const existing = await prisma.employee.findFirst({
    where: { id, facilityId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const parsed = await parseJsonBody(request, employeePatchSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;

  const updateData: Prisma.EmployeeUpdateInput = {};

  if (data.firstName !== undefined) updateData.firstName = data.firstName.trim();
  if (data.lastName !== undefined) updateData.lastName = data.lastName.trim();
  if (data.qualificationTags !== undefined) {
    updateData.qualificationTags = data.qualificationTags;
  }
  if (data.preferredShiftTypes !== undefined) {
    updateData.preferredShiftTypes = data.preferredShiftTypes;
  }
  if (data.mainStation !== undefined) {
    updateData.mainStation = data.mainStation;
  }
  if (data.assignedStations !== undefined) {
    updateData.assignedStations = data.assignedStations;
  }
  if (data.status !== undefined) {
    updateData.status = data.status;
  }
  if (data.isFullTimeBl !== undefined) {
    updateData.isFullTimeBl = data.isFullTimeBl;
  }
  if (data.fixedWorkingDays !== undefined) {
    updateData.fixedWorkingDays = data.fixedWorkingDays;
  }
  if (data.maxConsecutiveDays !== undefined) {
    updateData.maxConsecutiveDays = data.maxConsecutiveDays;
  }
  if (data.shiftDistribution !== undefined) {
    updateData.shiftDistribution = data.shiftDistribution ?? Prisma.JsonNull;
  }
  if (data.qualificationIds !== undefined) {
    updateData.qualifications = {
      set: data.qualificationIds.map((qid: string) => ({ id: qid })),
    };
  }
  if (data.allowedShiftProfileIds !== undefined) {
    updateData.allowedShiftProfiles = {
      set: data.allowedShiftProfileIds.map((pid: string) => ({ id: pid })),
    };
  }

  const contractRes = await resolveContractForPatch(
    facilityId,
    {
      workProfileId: existing.workProfileId,
      contractType: existing.contractType as ContractType,
      targetHoursPercent: existing.targetHoursPercent,
      miniJobMaxMonthlyHours: existing.miniJobMaxMonthlyHours,
    },
    {
      workProfileId: data.workProfileId,
      contractType: data.contractType,
      targetHoursPercent: data.targetHoursPercent,
      miniJobMaxMonthlyHours: data.miniJobMaxMonthlyHours,
    },
  );
  if (!contractRes.ok) {
    return NextResponse.json({ error: contractRes.error }, { status: contractRes.status });
  }

  if (contractRes.workProfile != null) {
    updateData.workProfile = contractRes.workProfile;
  }
  if (contractRes.block) {
    updateData.contractType = contractRes.block.contractType;
    updateData.targetHours = contractRes.block.targetHours;
    updateData.targetHoursPeriod = contractRes.block.targetHoursPeriod;
    updateData.miniJobMaxMonthlyHours = contractRes.block.miniJobMaxMonthlyHours;
    updateData.targetHoursPercent = contractRes.block.targetHoursPercent;
  }

  try {
    const employee = await prisma.employee.update({
      where: { id },
      data: updateData,
      include: employeeInclude,
    });
    return NextResponse.json({ employee: serializeEmployee(employee) });
  } catch (e) {
    console.error("PATCH /api/employees/[id]", e);
    return NextResponse.json(
      { error: "Aktualisierung fehlgeschlagen." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const existing = await prisma.employee.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  // Block hard deletion if employee has assignments (preserves history)
  const assignmentCount = await prisma.assignment.count({
    where: { employeeId: id },
  });
  if (assignmentCount > 0) {
    return NextResponse.json(
      {
        error:
          "Mitarbeiter hat Dienstplan-Zuweisungen und kann nicht gelöscht werden. " +
          'Bitte stattdessen auf "Inaktiv" setzen, um historische Daten zu bewahren.',
      },
      { status: 409 },
    );
  }

  try {
    await prisma.employee.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("DELETE /api/employees/[id]", e);
    return NextResponse.json(
      { error: "Mitarbeiter konnte nicht gelöscht werden (evtl. noch verknüpfte Daten)." },
      { status: 500 },
    );
  }
}
