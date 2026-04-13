import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const patchSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    abbreviation: z.string().min(1).max(10).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "Mindestens ein Feld zum Aktualisieren angeben",
  });

function serialize(q: {
  id: string;
  facilityId: string;
  name: string;
  abbreviation: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
}) {
  return {
    id: q.id,
    facilityId: q.facilityId,
    name: q.name,
    abbreviation: q.abbreviation,
    isActive: q.isActive,
    sortOrder: q.sortOrder,
    createdAt: q.createdAt.toISOString(),
  };
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const existing = await prisma.qualification.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;

  try {
    const qualification = await prisma.qualification.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.abbreviation !== undefined && { abbreviation: data.abbreviation }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    });
    return NextResponse.json({ qualification: serialize(qualification) });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        {
          error:
            "Eine Qualifikation mit diesem Namen oder dieser Abkürzung existiert bereits.",
        },
        { status: 409 },
      );
    }
    console.error("PATCH /api/qualifications/[id]", e);
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
  const existing = await prisma.qualification.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const empCount = await prisma.employee.count({
    where: { qualifications: { some: { id } } },
  });
  if (empCount > 0) {
    return NextResponse.json(
      {
        error:
          "Diese Qualifikation ist noch Mitarbeitenden zugeordnet und kann nicht gelöscht werden.",
      },
      { status: 409 },
    );
  }

  try {
    await prisma.qualification.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("DELETE /api/qualifications/[id]", e);
    return NextResponse.json(
      { error: "Qualifikation konnte nicht gelöscht werden." },
      { status: 500 },
    );
  }
}
