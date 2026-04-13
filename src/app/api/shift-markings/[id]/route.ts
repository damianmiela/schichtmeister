import { NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

type RouteCtx = { params: Promise<{ id: string }> };

/** PATCH — update a shift marking */
export async function PATCH(request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const facilityId = session!.user.facilityId;

  const existing = await prisma.shiftMarking.findFirst({
    where: { id, facilityId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const body = await request.json();
  const data: Record<string, unknown> = {};

  if (typeof body.code === "string") {
    const code = body.code.trim().toUpperCase();
    if (!code || code.length > 10) {
      return NextResponse.json({ error: "Code muss 1-10 Zeichen lang sein" }, { status: 400 });
    }
    data.code = code;
  }
  if (typeof body.label === "string") {
    const label = body.label.trim();
    if (!label || label.length > 50) {
      return NextResponse.json({ error: "Bezeichnung muss 1-50 Zeichen lang sein" }, { status: 400 });
    }
    data.label = label;
  }
  if (typeof body.color === "string") data.color = body.color.trim();
  if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Keine Änderungen" }, { status: 400 });
  }

  try {
    const marking = await prisma.shiftMarking.update({
      where: { id },
      data,
    });
    return NextResponse.json({ marking });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
      return NextResponse.json({ error: "Code existiert bereits" }, { status: 409 });
    }
    throw e;
  }
}

/** DELETE — remove a shift marking */
export async function DELETE(_request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const facilityId = session!.user.facilityId;

  const existing = await prisma.shiftMarking.findFirst({
    where: { id, facilityId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  await prisma.shiftMarking.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}
