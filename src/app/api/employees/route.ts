import { NextRequest, NextResponse } from "next/server";
import { ContractType, TargetHoursPeriod } from "@prisma/client";
import { employeeCreateSchema } from "@/lib/api/employeeSchemas";
import { serializeEmployee } from "@/lib/api/employeeSerialize";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const facilityId = session!.user.facilityId;
  const where = { facilityId };
  const params = request.nextUrl.searchParams;
  const pageParam = params.get("page");

  if (pageParam != null) {
    const page = Math.max(1, parseInt(pageParam, 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(params.get("pageSize") ?? "50", 10) || 50),
    );
    const skip = (page - 1) * pageSize;
    const [employees, total] = await prisma.$transaction([
      prisma.employee.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: pageSize,
      }),
      prisma.employee.count({ where }),
    ]);
    return NextResponse.json({
      employees: employees.map(serializeEmployee),
      page,
      pageSize,
      total,
    });
  }

  const employees = await prisma.employee.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return NextResponse.json({
    employees: employees.map(serializeEmployee),
  });
}

export async function POST(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const parsed = await parseJsonBody(request, employeeCreateSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const data = parsed.data;
    const employee = await prisma.employee.create({
      data: {
        facilityId: session!.user.facilityId,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        contractType: data.contractType as ContractType,
        targetHours: data.targetHours ?? undefined,
        targetHoursPeriod:
          data.targetHours != null
            ? (data.targetHoursPeriod as TargetHoursPeriod | null) ??
              TargetHoursPeriod.WEEKLY
            : undefined,
        miniJobMaxMonthlyHours:
          data.miniJobMaxMonthlyHours === undefined
            ? undefined
            : data.miniJobMaxMonthlyHours,
        qualificationTags: data.qualificationTags ?? [],
        preferredShiftTypes: data.preferredShiftTypes ?? [],
      },
    });

    return NextResponse.json(
      { employee: serializeEmployee(employee) },
      { status: 201 },
    );
  } catch (e) {
    console.error("POST /api/employees", e);
    return NextResponse.json(
      { error: "Mitarbeiter konnte nicht angelegt werden." },
      { status: 500 },
    );
  }
}
