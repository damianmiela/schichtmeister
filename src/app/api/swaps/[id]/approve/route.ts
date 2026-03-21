import { NextRequest, NextResponse } from "next/server";
import { SwapStatus } from "@prisma/client";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { swapApproveBodySchema } from "@/lib/api/swapSchemas";
import {
  SwapApproveRejected,
  applyApprovedSwap,
} from "@/lib/api/swapMutations";
import { swapApproveFailureResponse } from "@/lib/api/swapHttp";
import { serializeSwap } from "@/lib/api/swapSerialize";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const parsed = await parseJsonBody(request, swapApproveBodySchema);
  if (!parsed.ok) return parsed.response;

  const facilityId = session!.user.facilityId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const swap = await tx.swapRequest.findUnique({
        where: { id },
        include: {
          fromAssignment: { include: { schedule: true } },
        },
      });
      if (!swap || swap.fromAssignment.schedule.facilityId !== facilityId) {
        throw new SwapApproveRejected({
          kind: "http",
          status: 404,
          error: "Tausch nicht gefunden.",
        });
      }
      if (swap.status !== SwapStatus.REQUESTED) {
        throw new SwapApproveRejected({
          kind: "http",
          status: 409,
          error: "Tausch ist nicht mehr offen zur Freigabe.",
        });
      }

      const targetId = parsed.data.toEmployeeId ?? swap.toEmployeeId;
      if (!targetId) {
        throw new SwapApproveRejected({
          kind: "http",
          status: 400,
          error: "toEmployeeId im Body erforderlich, wenn die Anfrage ohne Ziel erstellt wurde.",
        });
      }

      const out = await applyApprovedSwap(
        tx,
        facilityId,
        swap.fromAssignmentId,
        targetId,
        session!.user.id,
        swap.id,
      );
      if (!out.ok) {
        throw new SwapApproveRejected(out.failure);
      }

      return tx.swapRequest.findUniqueOrThrow({ where: { id } });
    });

    return NextResponse.json({ swap: serializeSwap(result) });
  } catch (e) {
    if (e instanceof SwapApproveRejected) {
      return swapApproveFailureResponse(e.failure);
    }
    console.error("PATCH /api/swaps/[id]/approve", e);
    return NextResponse.json(
      { error: "Freigabe fehlgeschlagen." },
      { status: 500 },
    );
  }
}
