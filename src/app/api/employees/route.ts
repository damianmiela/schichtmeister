import { NextRequest, NextResponse } from "next/server";
import { ContractType, TargetHoursPeriod } from "@prisma/client";
import { employeeCreateSchema } from "@/lib/api/employeeSchemas";
import { serializeEmployee } from "@/lib/api/employeeSerialize";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  defaultEmployeeFieldsWithoutProfile,
  denormalizedEmployeeFieldsFromShiftProfile,
} from "@/lib/employeeShiftProfileSync";

const employeeInclude = { shiftProfile: true } as const;

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
    const shiftProfileId = data.shiftProfileId ?? null;

    type ContractBlock = {
      contractType: ContractType;
      targetHours: number | null;
      targetHoursPeriod: TargetHoursPeriod | null;
      miniJobMaxMonthlyHours: number | null;
    };

    let contractBlock: ContractBlock;

    if (shiftProfileId) {
      const prof = await prisma.shiftProfile.findFirst({
        where: { id: shiftProfileId, facilityId },
      });
      if (!prof) {
        return NextResponse.json(
          { error: "Schichtprofil nicht gefunden." },
          { status: 400 },
        );
      }
      contractBlock = denormalizedEmployeeFieldsFromShiftProfile(prof);
    } else {
      const def = defaultEmployeeFieldsWithoutProfile();
      contractBlock = {
        contractType: (data.contractType ?? def.contractType) as ContractType,
        targetHours: data.targetHours ?? def.targetHours ?? null,
        targetHoursPeriod:
          data.targetHours != null
            ? (data.targetHoursPeriod as TargetHoursPeriod | null) ??
              TargetHoursPeriod.WEEKLY
            : def.targetHoursPeriod ?? null,
        miniJobMaxMonthlyHours:
          data.miniJobMaxMonthlyHours !== undefined
            ? data.miniJobMaxMonthlyHours
            : def.miniJobMaxMonthlyHours ?? null,
      };
    }

    const employee = await prisma.employee.create({
      data: {
        facilityId,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        shiftProfileId,
        contractType: contractBlock.contractType,
        targetHours: contractBlock.targetHours ?? undefined,
        targetHoursPeriod: contractBlock.targetHoursPeriod ?? undefined,
        miniJobMaxMonthlyHours: contractBlock.miniJobMaxMonthlyHours ?? undefined,
        qualificationTags: data.qualificationTags ?? [],
        preferredShiftTypes: data.preferredShiftTypes ?? [],
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
