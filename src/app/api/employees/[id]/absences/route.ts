import { NextRequest, NextResponse } from "next/server";
import type { AbsenceType, EmployeeAbsence } from "@prisma/client";
import { z } from "zod";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createAbsenceSchema = z.object({
  type: z.enum(["KRANK", "URLAUB"]),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  note: z.string().optional(),
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

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const employee = await prisma.employee.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!employee) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const absences = await prisma.employeeAbsence.findMany({
    where: { employeeId: id },
    orderBy: { startDate: "asc" },
  });

  return NextResponse.json({
    absences: absences.map(serializeAbsence),
  });
}

export async function POST(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const employee = await prisma.employee.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!employee) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const parsed = await parseJsonBody(request, createAbsenceSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;
  const startDate = new Date(data.startDate + "T00:00:00Z");
  const endDate = new Date(data.endDate + "T00:00:00Z");
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
  }
  if (startDate > endDate) {
    return NextResponse.json(
      { error: "Startdatum darf nicht nach dem Enddatum liegen." },
      { status: 400 },
    );
  }

  try {
    const absence = await prisma.employeeAbsence.create({
      data: {
        employeeId: id,
        type: data.type as AbsenceType,
        startDate,
        endDate,
        note: data.note?.trim() ? data.note.trim() : undefined,
      },
    });
    return NextResponse.json({ absence: serializeAbsence(absence) }, { status: 201 });
  } catch (e) {
    console.error("POST /api/employees/[id]/absences", e);
    return NextResponse.json(
      { error: "Abwesenheit konnte nicht angelegt werden." },
      { status: 500 },
    );
  }
}
