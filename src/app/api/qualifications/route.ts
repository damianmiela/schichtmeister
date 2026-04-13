import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  abbreviation: z.string().min(1).max(10),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
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

export async function GET(_request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const qualifications = await prisma.qualification.findMany({
    where: { facilityId: session!.user.facilityId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({
    qualifications: qualifications.map(serialize),
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
    const qualification = await prisma.qualification.create({
      data: {
        facilityId: session!.user.facilityId,
        name: data.name,
        abbreviation: data.abbreviation,
        isActive: data.isActive ?? true,
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });
    return NextResponse.json(
      { qualification: serialize(qualification) },
      { status: 201 },
    );
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
    console.error("POST /api/qualifications", e);
    return NextResponse.json(
      { error: "Qualifikation konnte nicht angelegt werden." },
      { status: 500 },
    );
  }
}
