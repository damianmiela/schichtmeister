import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ContractType, TargetHoursPeriod } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { requirePlanner } from "@/lib/auth/session";

const createSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  contractType: z.enum(["FULL_TIME", "PART_TIME", "MINI_JOB"]),
  targetHours: z.number().positive().optional().nullable(),
  targetHoursPeriod: z.enum(["WEEKLY", "MONTHLY"]).optional().nullable(),
  qualificationTags: z.array(z.string()).optional(),
});

function serializeEmployee(e: {
  id: string;
  firstName: string;
  lastName: string;
  contractType: ContractType;
  targetHours: { toString(): string } | null;
  targetHoursPeriod: string | null;
  miniJobMaxMonthlyHours: { toString(): string } | null;
  qualificationTags: string[];
  createdAt: Date;
}) {
  return {
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    contractType: e.contractType,
    targetHours: e.targetHours != null ? Number(e.targetHours) : null,
    targetHoursPeriod: e.targetHoursPeriod,
    miniJobMaxMonthlyHours:
      e.miniJobMaxMonthlyHours != null
        ? Number(e.miniJobMaxMonthlyHours)
        : null,
    qualificationTags: e.qualificationTags,
    createdAt: e.createdAt.toISOString(),
  };
}

export async function GET() {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }
  if (error === "FORBIDDEN") {
    return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  }

  const employees = await prisma.employee.findMany({
    where: { facilityId: session!.user.facilityId },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return NextResponse.json({
    employees: employees.map(serializeEmployee),
  });
}

export async function POST(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }
  if (error === "FORBIDDEN") {
    return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  }

  try {
    const json = await request.json();
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ungültige Eingabe", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

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
        qualificationTags: data.qualificationTags ?? [],
      },
    });

    return NextResponse.json(
      { employee: serializeEmployee(employee) },
      { status: 201 }
    );
  } catch (e) {
    console.error("POST /api/employees", e);
    return NextResponse.json(
      { error: "Mitarbeiter konnte nicht angelegt werden." },
      { status: 500 }
    );
  }
}
