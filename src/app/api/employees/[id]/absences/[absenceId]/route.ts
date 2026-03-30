import { NextRequest, NextResponse } from "next/server";
import type { AbsenceType, EmployeeAbsence } from "@prisma/client";
import { z } from "zod";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const patchAbsenceSchema = z
  .object({
    type: z.enum(["KRANK", "URLAUB"]).optional(),
    startDate: dateStringSchema.optional(),
    endDate: dateStringSchema.optional(),
    note: z.string().optional().nullable(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "Mindestens ein Feld zum Aktualisieren angeben",
  });

function serializeAbsence(a: EmployeeAbsence) {
  return {
    id: a.id,
    employeeId: a.employeeId,
    type: a.type,
    startDate: a.startDate.toISOString().slice(0, 10),
    endDate: a.endDate.toISOString().slice(0, 10),
    note: a.note,
    createdAt: a.createdAt.toISOString(),
  };
}

type RouteCtx = { params: Promise<{ id: string; absenceId: string }> };

export async function PATCH(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id, absenceId } = await context.params;
  const existing = await prisma.employeeAbsence.findFirst({
    where: {
      id: absenceId,
      employeeId: id,
      employee: { facilityId: session!.user.facilityId },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const parsed = await parseJsonBody(request, patchAbsenceSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;
  const nextStart =
    data.startDate !== undefined
      ? new Date(data.startDate + "T00:00:00Z")
      : existing.startDate;
  const nextEnd =
    data.endDate !== undefined
      ? new Date(data.endDate + "T00:00:00Z")
      : existing.endDate;

  if (data.startDate !== undefined || data.endDate !== undefined) {
    if (
      (data.startDate !== undefined && Number.isNaN(nextStart.getTime())) ||
      (data.endDate !== undefined && Number.isNaN(nextEnd.getTime()))
    ) {
      return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
    }
    if (nextStart > nextEnd) {
      return NextResponse.json(
        { error: "Startdatum darf nicht nach dem Enddatum liegen." },
        { status: 400 },
      );
    }
  }

  try {
    const absence = await prisma.employeeAbsence.update({
      where: { id: absenceId },
      data: {
        ...(data.type !== undefined && { type: data.type as AbsenceType }),
        ...(data.startDate !== undefined && { startDate: nextStart }),
        ...(data.endDate !== undefined && { endDate: nextEnd }),
        ...(data.note !== undefined && {
          note: data.note === null || data.note.trim() === "" ? null : data.note.trim(),
        }),
      },
    });
    return NextResponse.json({ absence: serializeAbsence(absence) });
  } catch (e) {
    console.error("PATCH /api/employees/[id]/absences/[absenceId]", e);
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

  const { id, absenceId } = await context.params;
  const existing = await prisma.employeeAbsence.findFirst({
    where: {
      id: absenceId,
      employeeId: id,
      employee: { facilityId: session!.user.facilityId },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  try {
    await prisma.employeeAbsence.delete({ where: { id: absenceId } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("DELETE /api/employees/[id]/absences/[absenceId]", e);
    return NextResponse.json(
      { error: "Abwesenheit konnte nicht gelöscht werden." },
      { status: 500 },
    );
  }
}
