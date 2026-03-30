import { NextResponse } from "next/server";
import { requirePlanner } from "@/lib/auth/session";
import { plannerJsonErrors } from "@/lib/api/validation";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: Request) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { searchParams } = new URL(request.url);
  const scheduleId = searchParams.get("scheduleId");
  if (!scheduleId) {
    return NextResponse.json({ error: "Parameter 'scheduleId' fehlt" }, { status: 400 });
  }

  const schedule = await prisma.schedule.findFirst({
    where: {
      id: scheduleId,
      facilityId: session!.user.facilityId,
    },
    select: { generationLog: true },
  });

  return NextResponse.json({ content: schedule?.generationLog ?? null });
}
