import { NextRequest, NextResponse } from "next/server";
import { SwapStatus, UserRole } from "@prisma/client";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { swapCreateBodySchema } from "@/lib/api/swapSchemas";
import {
  serializeSwap,
  serializeSwapListItem,
} from "@/lib/api/swapSerialize";
import { requireAuth, requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const SWAP_STATUS_SET = new Set<string>(Object.values(SwapStatus));

/** Planner: all swap requests for assignments in this facility. */
export async function GET(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const facilityId = session!.user.facilityId;
  const statusParam = request.nextUrl.searchParams.get("status");
  const statusIn: SwapStatus[] | undefined =
    statusParam && statusParam.length > 0
      ? statusParam
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is SwapStatus => SWAP_STATUS_SET.has(s))
      : undefined;

  const swaps = await prisma.swapRequest.findMany({
    where: {
      ...(statusIn && statusIn.length > 0 ? { status: { in: statusIn } } : {}),
      fromAssignment: { schedule: { facilityId } },
    },
    include: {
      fromAssignment: {
        include: {
          employee: true,
          shiftProfile: true,
        },
      },
      toEmployee: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return NextResponse.json({
    swaps: swaps.map(serializeSwapListItem),
  });
}

/**
 * MVP: **Planner** may create a swap for any assignment in the facility.
 * **Employee** may create only for assignments where they are the assigned person (`assignment.employeeId`).
 */
export async function POST(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();

  const parsed = await parseJsonBody(request, swapCreateBodySchema);
  if (!parsed.ok) return parsed.response;

  const facilityId = session!.user.facilityId;
  const role = session!.user.role;

  const assignment = await prisma.assignment.findUnique({
    where: { id: parsed.data.fromAssignmentId },
    include: { schedule: true },
  });
  if (!assignment || assignment.schedule.facilityId !== facilityId) {
    return NextResponse.json({ error: "Zuweisung nicht gefunden." }, { status: 404 });
  }

  const isPlanner = role === UserRole.PLANNER;
  const isOwner =
    role === UserRole.EMPLOYEE && session!.user.employeeId === assignment.employeeId;
  if (!isPlanner && !isOwner) {
    return plannerJsonErrors.forbidden();
  }

  if (parsed.data.toEmployeeId) {
    const to = await prisma.employee.findFirst({
      where: { id: parsed.data.toEmployeeId, facilityId },
    });
    if (!to) {
      return NextResponse.json(
        { error: "Ziel-Mitarbeiter nicht gefunden." },
        { status: 400 },
      );
    }
  }

  try {
    const existing = await prisma.swapRequest.findUnique({
      where: { fromAssignmentId: parsed.data.fromAssignmentId },
    });

    if (existing) {
      if (
        existing.status === SwapStatus.REQUESTED ||
        existing.status === SwapStatus.APPROVED
      ) {
        return NextResponse.json(
          { error: "Für diese Zuweisung gibt es bereits einen aktiven Tausch." },
          { status: 409 },
        );
      }
      const updated = await prisma.swapRequest.update({
        where: { id: existing.id },
        data: {
          status: SwapStatus.REQUESTED,
          toEmployeeId: parsed.data.toEmployeeId ?? undefined,
          plannerDecisionReason: null,
          approvedByUserId: null,
          approvedAt: null,
        },
      });
      return NextResponse.json({ swap: serializeSwap(updated) }, { status: 201 });
    }

    const created = await prisma.swapRequest.create({
      data: {
        fromAssignmentId: parsed.data.fromAssignmentId,
        toEmployeeId: parsed.data.toEmployeeId ?? undefined,
        status: SwapStatus.REQUESTED,
      },
    });
    return NextResponse.json({ swap: serializeSwap(created) }, { status: 201 });
  } catch (e) {
    console.error("POST /api/swaps", e);
    return NextResponse.json(
      { error: "Tausch-Anfrage konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }
}
