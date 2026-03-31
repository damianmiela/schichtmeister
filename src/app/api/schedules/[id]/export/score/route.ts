import { NextResponse } from "next/server";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const facilityId = session!.user.facilityId;
  const { id: scheduleId } = await context.params;

  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId },
    select: {
      scoreReport: true,
      periodStart: true,
      periodEnd: true,
    },
  });

  if (!schedule) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  if (!schedule.scoreReport) {
    return NextResponse.json(
      { error: "Kein Qualitätsbericht vorhanden. Bitte zuerst den Dienstplan generieren." },
      { status: 404 },
    );
  }

  const ps = toIsoDateOnly(schedule.periodStart);
  const pe = toIsoDateOnly(schedule.periodEnd);
  const filename = `Qualitaetsbericht_${ps}_${pe}.txt`;

  return new NextResponse(schedule.scoreReport, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
