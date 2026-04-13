import { NextRequest, NextResponse } from "next/server";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { plannerJsonErrors } from "@/lib/api/validation";

type RouteCtx = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const existing = await prisma.employeeWorkProfile.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  try {
    await prisma.employeeWorkProfile.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("DELETE /api/employee-work-profiles/[id]", e);
    return NextResponse.json(
      { error: "Profil konnte nicht gelöscht werden." },
      { status: 500 },
    );
  }
}
