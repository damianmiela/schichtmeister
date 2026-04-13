import { NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

/** GET — list all shift markings for the facility */
export async function GET() {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const facilityId = session!.user.facilityId;

  const markings = await prisma.shiftMarking.findMany({
    where: { facilityId },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ markings });
}

/** POST — create a new shift marking */
export async function POST(request: Request) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const facilityId = session!.user.facilityId;
  const body = await request.json();

  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const color = typeof body.color === "string" ? body.color.trim() : "#757575";

  if (!code || code.length > 10) {
    return NextResponse.json({ error: "Code muss 1-10 Zeichen lang sein" }, { status: 400 });
  }
  if (!label || label.length > 50) {
    return NextResponse.json({ error: "Bezeichnung muss 1-50 Zeichen lang sein" }, { status: 400 });
  }

  // Get next sort order
  const last = await prisma.shiftMarking.findFirst({
    where: { facilityId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const sortOrder = (last?.sortOrder ?? -1) + 1;

  try {
    const marking = await prisma.shiftMarking.create({
      data: { facilityId, code, label, color, sortOrder },
    });
    return NextResponse.json({ marking }, { status: 201 });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
      return NextResponse.json({ error: `Code "${code}" existiert bereits` }, { status: 409 });
    }
    throw e;
  }
}
