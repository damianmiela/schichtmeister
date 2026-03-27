import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const createSchema = z.object({
  qualificationTag: z.string().min(1),
  minCount: z.number().int().min(1).default(1),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;

  const sr = await prisma.staffingRequirement.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!sr) {
    return NextResponse.json({ error: "Personalbedarf nicht gefunden." }, { status: 404 });
  }

  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const qr = await prisma.qualificationRequirement.create({
      data: {
        staffingRequirementId: sr.id,
        qualificationTag: parsed.data.qualificationTag,
        minCount: parsed.data.minCount,
      },
    });
    return NextResponse.json({ qualificationRequirement: qr }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Qualifikation existiert bereits für diesen Personalbedarf." },
        { status: 409 },
      );
    }
    console.error("POST qualifications", e);
    return NextResponse.json({ error: "Anlegen fehlgeschlagen." }, { status: 500 });
  }
}
