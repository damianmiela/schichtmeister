import { NextRequest, NextResponse } from "next/server";
import { AuditAction, SwapStatus } from "@prisma/client";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { swapRejectBodySchema } from "@/lib/api/swapSchemas";
import { serializeSwap } from "@/lib/api/swapSerialize";
import {
  AUDIT_ENTITY_SWAP_REQUEST,
  swapAuditSnapshot,
  writeAuditLog,
} from "@/lib/audit";
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

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.swapRequest.update({
      where: { id },
      data: {
        status: SwapStatus.REJECTED,
        plannerDecisionReason: parsed.data.plannerDecisionReason ?? undefined,
      },
    });
    await writeAuditLog(tx, {
      entityType: AUDIT_ENTITY_SWAP_REQUEST,
      entityId: id,
      action: AuditAction.UPDATE,
      actorUserId: session!.user.id,
      before: swapAuditSnapshot(swap),
      after: swapAuditSnapshot(next),
    });
    return next;
  });

  return NextResponse.json({ swap: serializeSwap(updated) });
}
