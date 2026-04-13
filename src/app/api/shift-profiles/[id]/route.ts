import { NextRequest, NextResponse } from "next/server";
import { Prisma, ShiftType } from "@prisma/client";
import { z } from "zod";
import { shiftTypeZ } from "@/lib/api/employeeSchemas";
import { hhmmSchema, parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const patchSchema = z
  .object({
    name: z.string().min(1).max(20).optional(),
    shiftType: shiftTypeZ.optional(),
    startTime: hhmmSchema.optional(),
    endTime: hhmmSchema.optional(),
    breakMinutes: z.number().int().min(0).max(24 * 60).optional(),
    startTime2: hhmmSchema.optional().nullable(),
    endTime2: hhmmSchema.optional().nullable(),
    breakMinutes2: z.number().int().min(0).max(24 * 60).optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "Mindestens ein Feld zum Aktualisieren angeben",
  });

function serialize(p: {
  id: string;
  name: string;
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  startTime2: string | null;
  endTime2: string | null;
  breakMinutes2: number | null;
  isActive: boolean;
  createdAt: Date;
}) {
  return {
    id: p.id,
    name: p.name,
    shiftType: p.shiftType,
    startTime: p.startTime,
    endTime: p.endTime,
    breakMinutes: p.breakMinutes,
    startTime2: p.startTime2,
    endTime2: p.endTime2,
    breakMinutes2: p.breakMinutes2,
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

  try {
    const profile = await prisma.shiftProfile.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.shiftType !== undefined && { shiftType: data.shiftType as ShiftType }),
        ...(data.startTime !== undefined && { startTime: data.startTime }),
        ...(data.endTime !== undefined && { endTime: data.endTime }),
        ...(data.breakMinutes !== undefined && { breakMinutes: data.breakMinutes }),
        ...(data.startTime2 !== undefined && { startTime2: data.startTime2 }),
        ...(data.endTime2 !== undefined && { endTime2: data.endTime2 }),
        ...(data.breakMinutes2 !== undefined && { breakMinutes2: data.breakMinutes2 }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
    return NextResponse.json({ shiftProfile: serialize(profile) });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Ein Schichtprofil mit diesem Namen existiert bereits." },
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
