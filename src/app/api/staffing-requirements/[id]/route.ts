import { NextRequest, NextResponse } from "next/server";
import { Prisma, ShiftType } from "@prisma/client";
import { z } from "zod";
import { shiftTypeZ } from "@/lib/api/employeeSchemas";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const patchSchema = z
  .object({
    shiftType: shiftTypeZ.optional(),
    stationNumber: z.number().int().min(0).max(3).optional(),
    minTotalCount: z.number().int().min(0).optional(),
    maxTotalCount: z.number().int().min(0).optional().nullable(),
    isFacilityWide: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "Mindestens ein Feld zum Aktualisieren angeben",
  });

function serialize(r: {
  id: string;
  shiftType: ShiftType;
  stationNumber: number;
  minTotalCount: number;
  maxTotalCount: number | null;
  isFacilityWide: boolean;
  qualificationRequirements: { id: string; qualificationTag: string; minCount: number }[];
  createdAt: Date;
}) {
  return {
    id: r.id,
    shiftType: r.shiftType,
    stationNumber: r.stationNumber,
    minTotalCount: r.minTotalCount,
    maxTotalCount: r.maxTotalCount,
    isFacilityWide: r.isFacilityWide,
    qualificationRequirements: r.qualificationRequirements.map((q) => ({
      id: q.id,
      qualificationTag: q.qualificationTag,
      minCount: q.minCount,
    })),
    createdAt: r.createdAt.toISOString(),
  };
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const existing = await prisma.staffingRequirement.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;
  try {
    const row = await prisma.staffingRequirement.update({
      where: { id },
      data: {
        ...(data.shiftType !== undefined && { shiftType: data.shiftType as ShiftType }),
        ...(data.stationNumber !== undefined && { stationNumber: data.stationNumber }),
        ...(data.minTotalCount !== undefined && { minTotalCount: data.minTotalCount }),
        ...(data.maxTotalCount !== undefined && { maxTotalCount: data.maxTotalCount }),
        ...(data.isFacilityWide !== undefined && { isFacilityWide: data.isFacilityWide }),
      },
      include: { qualificationRequirements: true },
    });
    return NextResponse.json({ staffingRequirement: serialize(row) });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Für diesen Schichttyp und Station existiert bereits ein Eintrag." },
        { status: 409 },
      );
    }
    console.error("PATCH /api/staffing-requirements/[id]", e);
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
  const existing = await prisma.staffingRequirement.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  try {
    await prisma.staffingRequirement.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/staffing-requirements/[id]", e);
    return NextResponse.json(
      { error: "Löschen fehlgeschlagen." },
      { status: 500 },
    );
  }
}
