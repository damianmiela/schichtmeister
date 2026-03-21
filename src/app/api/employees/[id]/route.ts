import { NextRequest, NextResponse } from "next/server";
import { ContractType, TargetHoursPeriod } from "@prisma/client";
import { employeePatchSchema } from "@/lib/api/employeeSchemas";
import { serializeEmployee } from "@/lib/api/employeeSerialize";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const employee = await prisma.employee.findFirst({
    where: { id, facilityId: session!.user.facilityId },
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
  const existing = await prisma.employee.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const parsed = await parseJsonBody(request, employeePatchSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;
  try {
    const employee = await prisma.employee.update({
      where: { id },
      data: {
        ...(data.firstName !== undefined && { firstName: data.firstName.trim() }),
        ...(data.lastName !== undefined && { lastName: data.lastName.trim() }),
        ...(data.contractType !== undefined && {
          contractType: data.contractType as ContractType,
        }),
        ...(data.targetHours !== undefined && { targetHours: data.targetHours }),
        ...(data.targetHoursPeriod !== undefined && {
          targetHoursPeriod: data.targetHoursPeriod as TargetHoursPeriod | null,
        }),
        ...(data.miniJobMaxMonthlyHours !== undefined && {
          miniJobMaxMonthlyHours: data.miniJobMaxMonthlyHours,
        }),
        ...(data.qualificationTags !== undefined && {
          qualificationTags: data.qualificationTags,
        }),
        ...(data.preferredShiftTypes !== undefined && {
          preferredShiftTypes: data.preferredShiftTypes,
        }),
      },
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
