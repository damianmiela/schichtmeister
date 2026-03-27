import { NextRequest, NextResponse } from "next/server";
import { Prisma, ShiftType } from "@prisma/client";
import { z } from "zod";
import { shiftTypeZ } from "@/lib/api/employeeSchemas";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const createSchema = z.object({
  shiftType: shiftTypeZ,
  stationNumber: z.number().int().min(1).max(3),
  minTotalCount: z.number().int().min(0),
});

function serialize(r: {
  id: string;
  shiftType: ShiftType;
  stationNumber: number;
  minTotalCount: number;
  qualificationRequirements: { id: string; qualificationTag: string; minCount: number }[];
  createdAt: Date;
}) {
  return {
    id: r.id,
    shiftType: r.shiftType,
    stationNumber: r.stationNumber,
    minTotalCount: r.minTotalCount,
    qualificationRequirements: r.qualificationRequirements.map((q) => ({
      id: q.id,
      qualificationTag: q.qualificationTag,
      minCount: q.minCount,
    })),
    createdAt: r.createdAt.toISOString(),
  };
}

export async function GET() {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const rows = await prisma.staffingRequirement.findMany({
    where: { facilityId: session!.user.facilityId },
    include: { qualificationRequirements: true },
    orderBy: [{ stationNumber: "asc" }, { shiftType: "asc" }],
  });
  return NextResponse.json({
    staffingRequirements: rows.map(serialize),
  });
}

export async function POST(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;
  try {
    const row = await prisma.staffingRequirement.create({
      data: {
        facilityId: session!.user.facilityId,
        shiftType: data.shiftType as ShiftType,
        stationNumber: data.stationNumber,
        minTotalCount: data.minTotalCount,
      },
      include: { qualificationRequirements: true },
    });
    return NextResponse.json(
      { staffingRequirement: serialize(row) },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Für diesen Schichttyp und Station existiert bereits ein Eintrag." },
        { status: 409 },
      );
    }
    console.error("POST /api/staffing-requirements", e);
    return NextResponse.json(
      { error: "Personalbedarf konnte nicht angelegt werden." },
      { status: 500 },
    );
  }
}
