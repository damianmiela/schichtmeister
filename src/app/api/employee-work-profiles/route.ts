import { NextRequest, NextResponse } from "next/server";
import { ContractType, Prisma } from "@prisma/client";
import { z } from "zod";
import { contractTypeZ } from "@/lib/api/employeeSchemas";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  targetHoursPercent: z.number().min(0).max(1000),
  contractType: contractTypeZ,
  miniJobMaxMonthlyHours: z.number().positive().optional().nullable(),
});

function serialize(p: {
  id: string;
  name: string;
  targetHoursPercent: { toString(): string } | number;
  contractType: ContractType;
  miniJobMaxMonthlyHours: { toString(): string } | null;
  createdAt: Date;
}) {
  return {
    id: p.id,
    name: p.name,
    targetHoursPercent: Number(p.targetHoursPercent),
    contractType: p.contractType,
    miniJobMaxMonthlyHours:
      p.miniJobMaxMonthlyHours != null ? Number(p.miniJobMaxMonthlyHours) : null,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function GET() {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const rows = await prisma.employeeWorkProfile.findMany({
    where: { facilityId: session!.user.facilityId },
    orderBy: [{ name: "asc" }],
  });
  return NextResponse.json({ workProfiles: rows.map(serialize) });
}

export async function POST(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;
  try {
    const row = await prisma.employeeWorkProfile.create({
      data: {
        facilityId: session!.user.facilityId,
        name: data.name.trim(),
        targetHoursPercent: data.targetHoursPercent,
        contractType: data.contractType as ContractType,
        miniJobMaxMonthlyHours:
          data.miniJobMaxMonthlyHours === undefined
            ? undefined
            : data.miniJobMaxMonthlyHours,
      },
    });
    return NextResponse.json({ workProfile: serialize(row) }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Ein gespeichertes Profil mit diesem Namen existiert bereits." },
        { status: 409 },
      );
    }
    console.error("POST /api/employee-work-profiles", e);
    return NextResponse.json(
      { error: "Profil konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }
}
