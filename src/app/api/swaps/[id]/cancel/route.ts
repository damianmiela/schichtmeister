import { NextResponse } from "next/server";
import { SwapStatus, UserRole } from "@prisma/client";
import { plannerJsonErrors } from "@/lib/api/validation";
import { serializeSwap } from "@/lib/api/swapSerialize";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

type RouteCtx = { params: Promise<{ id: string }> };

/** Employee (assignment owner) or planner may cancel a REQUESTED swap. */
export async function PATCH(_request: Request, context: RouteCtx) {
  const { session, error } = await requireAuth();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();

  const { id } = await context.params;
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
      { error: "Nur offene Anfragen können storniert werden." },
      { status: 409 },
    );
  }

  const isPlanner = session!.user.role === UserRole.PLANNER;
  const isOwner =
    session!.user.role === UserRole.EMPLOYEE &&
    session!.user.employeeId === swap.fromAssignment.employeeId;
  if (!isPlanner && !isOwner) {
    return plannerJsonErrors.forbidden();
  }

  const updated = await prisma.swapRequest.update({
    where: { id },
    data: { status: SwapStatus.CANCELLED },
  });

  return NextResponse.json({ swap: serializeSwap(updated) });
}
