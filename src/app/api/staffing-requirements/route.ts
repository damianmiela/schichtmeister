import { NextRequest, NextResponse } from "next/server";
import { Prisma, ShiftType } from "@prisma/client";
import { z } from "zod";
import { shiftTypeZ } from "@/lib/api/employeeSchemas";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const createSchema = z.object({
  shiftType: shiftTypeZ,
  minStaffCount: z.number().int().min(0),
  requiredQualificationTags: z.array(z.string()).optional(),
});

function serialize(r: {
  id: string;
  shiftType: ShiftType;
  minStaffCount: number;
  requiredQualificationTags: string[];
  createdAt: Date;
}) {
  return {
    id: r.id,
    shiftType: r.shiftType,
    minStaffCount: r.minStaffCount,
    requiredQualificationTags: r.requiredQualificationTags,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function GET() {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const rows = await prisma.staffingRequirement.findMany({
    where: { facilityId: session!.user.facilityId },
    orderBy: [{ shiftType: "asc" }],
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
        minStaffCount: data.minStaffCount,
        requiredQualificationTags: data.requiredQualificationTags ?? [],
      },
    });
    return NextResponse.json(
      { staffingRequirement: serialize(row) },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Für diesen Schichttyp existiert bereits ein Eintrag." },
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
