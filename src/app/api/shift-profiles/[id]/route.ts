import { NextRequest, NextResponse } from "next/server";
import { Prisma, ShiftType } from "@prisma/client";
import { z } from "zod";
import { shiftTypeZ } from "@/lib/api/employeeSchemas";
import { hhmmSchema, parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { autoProfileName } from "@/lib/schedule/stationHelpers";

const stationNumberZ = z.number().int().min(1).max(3);

const patchSchema = z
  .object({
    shiftType: shiftTypeZ.optional(),
    stationNumber: stationNumberZ.optional(),
    startTime: hhmmSchema.optional(),
    endTime: hhmmSchema.optional(),
    breakMinutes: z.number().int().min(0).max(24 * 60).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "Mindestens ein Feld zum Aktualisieren angeben",
  });

function serialize(p: {
  id: string;
  name: string;
  shiftType: ShiftType;
  stationNumber: number;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isActive: boolean;
  createdAt: Date;
}) {
  return {
    id: p.id,
    name: p.name,
    shiftType: p.shiftType,
    stationNumber: p.stationNumber,
    startTime: p.startTime,
    endTime: p.endTime,
    breakMinutes: p.breakMinutes,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
  };
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const existing = await prisma.shiftProfile.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;
  const newShiftType = (data.shiftType as ShiftType | undefined) ?? existing.shiftType;
  const newStation = data.stationNumber ?? existing.stationNumber;
  const newName = autoProfileName(newShiftType, newStation);

  try {
    const profile = await prisma.shiftProfile.update({
      where: { id },
      data: {
        name: newName,
        ...(data.shiftType !== undefined && { shiftType: data.shiftType as ShiftType }),
        ...(data.stationNumber !== undefined && { stationNumber: data.stationNumber }),
        ...(data.startTime !== undefined && { startTime: data.startTime }),
        ...(data.endTime !== undefined && { endTime: data.endTime }),
        ...(data.breakMinutes !== undefined && { breakMinutes: data.breakMinutes }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
    return NextResponse.json({ shiftProfile: serialize(profile) });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Für diesen Schichttyp und Station existiert bereits ein Profil." },
        { status: 409 },
      );
    }
    console.error("PATCH /api/shift-profiles/[id]", e);
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
  const existing = await prisma.shiftProfile.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const assignmentCount = await prisma.assignment.count({
    where: { shiftProfileId: id },
  });
  if (assignmentCount > 0) {
    return NextResponse.json(
      {
        error:
          "Dieses Profil ist noch in Dienstplan-Zuweisungen vergeben und kann nicht gelöscht werden.",
      },
      { status: 409 },
    );
  }

  try {
    await prisma.shiftProfile.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("DELETE /api/shift-profiles/[id]", e);
    return NextResponse.json(
      { error: "Schichtprofil konnte nicht gelöscht werden." },
      { status: 500 },
    );
  }
}
