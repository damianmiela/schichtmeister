import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { ContractType, TargetHoursPeriod } from "@prisma/client";
import { employeePatchSchema } from "@/lib/api/employeeSchemas";
import { serializeEmployee } from "@/lib/api/employeeSerialize";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  defaultEmployeeFieldsWithoutProfile,
  denormalizedEmployeeFieldsFromShiftProfile,
} from "@/lib/employeeShiftProfileSync";

const employeeInclude = { shiftProfile: true } as const;

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
  const hasProfile = existing.shiftProfileId != null;
  const linkChange = data.shiftProfileId !== undefined;

  const updateData: Prisma.EmployeeUpdateInput = {};

  if (data.firstName !== undefined) updateData.firstName = data.firstName.trim();
  if (data.lastName !== undefined) updateData.lastName = data.lastName.trim();
  if (data.qualificationTags !== undefined) {
    updateData.qualificationTags = data.qualificationTags;
  }
  if (data.preferredShiftTypes !== undefined) {
    updateData.preferredShiftTypes = data.preferredShiftTypes;
  }

  if (linkChange) {
    if (data.shiftProfileId === null) {
      updateData.shiftProfile = { disconnect: true };
      const d = defaultEmployeeFieldsWithoutProfile();
      updateData.contractType = d.contractType;
      updateData.targetHours = d.targetHours;
      updateData.targetHoursPeriod = d.targetHoursPeriod;
      updateData.miniJobMaxMonthlyHours = d.miniJobMaxMonthlyHours;
    } else {
      const prof = await prisma.shiftProfile.findFirst({
        where: { id: data.shiftProfileId, facilityId },
      });
      if (!prof) {
        return NextResponse.json(
          { error: "Schichtprofil nicht gefunden." },
          { status: 400 },
        );
      }
      updateData.shiftProfile = { connect: { id: prof.id } };
      const d = denormalizedEmployeeFieldsFromShiftProfile(prof);
      updateData.contractType = d.contractType;
      updateData.targetHours = d.targetHours;
      updateData.targetHoursPeriod = d.targetHoursPeriod;
      updateData.miniJobMaxMonthlyHours = d.miniJobMaxMonthlyHours;
    }
  } else if (!hasProfile) {
    if (data.contractType !== undefined) {
      updateData.contractType = data.contractType as ContractType;
    }
    if (data.targetHours !== undefined) updateData.targetHours = data.targetHours;
    if (data.targetHoursPeriod !== undefined) {
      updateData.targetHoursPeriod = data.targetHoursPeriod as TargetHoursPeriod | null;
    }
    if (data.miniJobMaxMonthlyHours !== undefined) {
      updateData.miniJobMaxMonthlyHours = data.miniJobMaxMonthlyHours;
    }
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
