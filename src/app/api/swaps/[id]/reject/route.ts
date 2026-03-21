import { NextRequest, NextResponse } from "next/server";
import { SwapStatus } from "@prisma/client";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { swapRejectBodySchema } from "@/lib/api/swapSchemas";
import { serializeSwap } from "@/lib/api/swapSerialize";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const parsed = await parseJsonBody(request, swapRejectBodySchema);
  if (!parsed.ok) return parsed.response;

  const facilityId = session!.user.facilityId;

  const swap = await prisma.swapRequest.findUnique({
    where: { id },
    include: {
      fromAssignment: { include: { schedule: true } },
    },
  });
  if (!swap || swap.fromAssignment.schedule.facilityId !== facilityId) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  if (swap.status !== SwapStatus.REQUESTED) {
    return NextResponse.json(
      { error: "Tausch ist nicht mehr offen." },
      { status: 409 },
    );
  }

  const updated = await prisma.swapRequest.update({
    where: { id },
    data: {
      status: SwapStatus.REJECTED,
      plannerDecisionReason: parsed.data.plannerDecisionReason ?? undefined,
    },
  });

  return NextResponse.json({ swap: serializeSwap(updated) });
}
