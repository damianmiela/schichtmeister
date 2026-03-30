import { NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id: scheduleId } = await context.params;
  const facilityId = session!.user.facilityId;

  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const result = await tx.assignment.deleteMany({ where: { scheduleId } });

    await tx.schedule.update({
      where: { id: scheduleId },
      data: {
        status: "DRAFT",
        publishedAt: null,
        warningsJson: null,
        preGenWishesJson: null,
        generationLog: null,
      },
    });

    return result.count;
  });

  return NextResponse.json({ deletedAssignments: deleted });
}
