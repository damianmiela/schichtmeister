import { NextRequest, NextResponse } from "next/server";
import { WishStatus } from "@prisma/client";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { wishDecideBodySchema } from "@/lib/api/wishSchemas";
import { serializeWish } from "@/lib/api/wishSerialize";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const parsed = await parseJsonBody(request, wishDecideBodySchema);
  if (!parsed.ok) return parsed.response;

  const wish = await prisma.wish.findFirst({
    where: { id, employee: { facilityId: session!.user.facilityId } },
  });
  if (!wish) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  if (wish.status !== WishStatus.OPEN) {
    return NextResponse.json(
      { error: "Wunsch ist nicht mehr offen." },
      { status: 409 },
    );
  }

  const updated = await prisma.wish.update({
    where: { id },
    data: {
      status:
        parsed.data.status === "FULFILLED"
          ? WishStatus.FULFILLED
          : WishStatus.NOT_FULFILLED,
      decisionReason: parsed.data.decisionReason ?? undefined,
    },
  });

  return NextResponse.json({ wish: serializeWish(updated) });
}
