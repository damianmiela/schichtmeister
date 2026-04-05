import { NextResponse } from "next/server";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import { plannerJsonErrors } from "@/lib/api/validation";
import { buildSchedulePdfBuffer } from "@/lib/export/buildSchedulePdf";
import { fetchScheduleExportBundle } from "@/lib/export/scheduleExportContext";
import { requirePlanner } from "@/lib/auth/session";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const bundle = await fetchScheduleExportBundle(id, session!.user.facilityId);
  if (!bundle) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  try {
    const buffer = await buildSchedulePdfBuffer(bundle);
    const ps = toIsoDateOnly(bundle.schedule.periodStart);
    const pe = toIsoDateOnly(bundle.schedule.periodEnd);
    const filename = `Dienstplan_${ps}_${pe}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("PDF generation failed:", e);
    return NextResponse.json(
      { error: "PDF-Generierung fehlgeschlagen." },
      { status: 500 },
    );
  }
}
