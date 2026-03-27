import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const patchSchema = z.object({
  minCount: z.number().int().min(1),
});

type RouteCtx = { params: Promise<{ id: string; qId: string }> };

async function findOwned(facilityId: string, srId: string, qId: string) {
  const sr = await prisma.staffingRequirement.findFirst({
    where: { id: srId, facilityId },
  });
  if (!sr) return null;
  return prisma.qualificationRequirement.findFirst({
    where: { id: qId, staffingRequirementId: sr.id },
  });
}

export async function PATCH(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id, qId } = await context.params;
  const qr = await findOwned(session!.user.facilityId, id, qId);
  if (!qr) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;

  const updated = await prisma.qualificationRequirement.update({
    where: { id: qId },
    data: { minCount: parsed.data.minCount },
  });
  return NextResponse.json({ qualificationRequirement: updated });
}

export async function DELETE(_request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id, qId } = await context.params;
  const qr = await findOwned(session!.user.facilityId, id, qId);
  if (!qr) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  await prisma.qualificationRequirement.delete({ where: { id: qId } });
  return NextResponse.json({ ok: true });
}
