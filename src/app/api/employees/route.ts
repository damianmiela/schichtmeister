import { NextRequest, NextResponse } from "next/server";
import { employeeCreateSchema } from "@/lib/api/employeeSchemas";
import { resolveContractForCreate } from "@/lib/api/employeeContractResolve";
import { serializeEmployee } from "@/lib/api/employeeSerialize";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const employeeInclude = {
  workProfile: true,
  qualifications: true,
  allowedShiftProfiles: true,
} as const;

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
        include: employeeInclude,
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
    include: employeeInclude,
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
    const facilityId = session!.user.facilityId;

    const resolved = await resolveContractForCreate(facilityId, {
      workProfileId: data.workProfileId,
      contractType: data.contractType,
      targetHoursPercent: data.targetHoursPercent,
      miniJobMaxMonthlyHours: data.miniJobMaxMonthlyHours,
    });
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const { block, workProfileConnectId } = resolved;

    const employee = await prisma.employee.create({
      data: {
        facilityId,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        contractType: block.contractType,
        status: data.status ?? undefined,
        targetHours: block.targetHours ?? undefined,
        targetHoursPeriod: block.targetHoursPeriod ?? undefined,
        miniJobMaxMonthlyHours: block.miniJobMaxMonthlyHours ?? undefined,
        targetHoursPercent: block.targetHoursPercent ?? undefined,
        workProfileId: workProfileConnectId ?? undefined,
        assignedStations: data.assignedStations ?? [],
        qualificationTags: data.qualificationTags ?? [],
        preferredShiftTypes: data.preferredShiftTypes ?? [],
        ...(data.qualificationIds && data.qualificationIds.length > 0
          ? { qualifications: { connect: data.qualificationIds.map((id: string) => ({ id })) } }
          : {}),
        ...(data.allowedShiftProfileIds && data.allowedShiftProfileIds.length > 0
          ? { allowedShiftProfiles: { connect: data.allowedShiftProfileIds.map((id: string) => ({ id })) } }
          : {}),
      },
      include: employeeInclude,
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
