import { NextRequest, NextResponse } from "next/server";
import { ShiftType } from "@prisma/client";
import { z } from "zod";
import { shiftTypeZ } from "@/lib/api/employeeSchemas";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const createSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  shiftType: shiftTypeZ,
  minStaffCount: z.number().int().min(0),
  requiredQualificationTags: z.array(z.string()).optional(),
});

function serialize(r: {
  id: string;
  dayOfWeek: number;
  shiftType: ShiftType;
  minStaffCount: number;
  requiredQualificationTags: string[];
  createdAt: Date;
}) {
  return {
    id: r.id,
    dayOfWeek: r.dayOfWeek,
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
    orderBy: [{ dayOfWeek: "asc" }, { shiftType: "asc" }],
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
        dayOfWeek: data.dayOfWeek,
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
    console.error("POST /api/staffing-requirements", e);
    return NextResponse.json(
      { error: "Personalbedarf konnte nicht angelegt werden." },
      { status: 500 },
    );
  }
}
