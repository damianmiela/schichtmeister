import { NextRequest, NextResponse } from "next/server";
import { ShiftType, UserRole, WishPriority, WishStatus } from "@prisma/client";
import { parseIsoDateOnly } from "@/lib/api/dateOnly";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { wishCreateBodySchema, parseWishQueryDates } from "@/lib/api/wishSchemas";
import { serializeWish } from "@/lib/api/wishSerialize";
import { requireAuth, requireEmployeeSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();

  const range = parseWishQueryDates(
    request.nextUrl.searchParams.get("from"),
    request.nextUrl.searchParams.get("to"),
  );
  if (!range.ok) {
    return NextResponse.json({ error: range.error }, { status: 400 });
  }
  const { from, to } = range;

  if (session!.user.role === UserRole.PLANNER) {
    const wishes = await prisma.wish.findMany({
      where: {
        employee: { facilityId: session!.user.facilityId },
        date: { gte: from, lte: to },
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({
      wishes: wishes.map((w) =>
        serializeWish(
          w,
          `${w.employee.firstName} ${w.employee.lastName}`.trim(),
        ),
      ),
    });
  }

  if (session!.user.role === UserRole.EMPLOYEE) {
    if (!session!.user.employeeId) {
      return plannerJsonErrors.forbidden();
    }
    const wishes = await prisma.wish.findMany({
      where: {
        employeeId: session!.user.employeeId,
        date: { gte: from, lte: to },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({
      wishes: wishes.map((w) => serializeWish(w)),
    });
  }

  return plannerJsonErrors.forbidden();
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireEmployeeSession();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const parsed = await parseJsonBody(request, wishCreateBodySchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;
  const date = parseIsoDateOnly(data.date);
  if (!date) {
    return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
  }

  const facilityId = session!.user.facilityId;
  const employeeId = session!.user.employeeId!;

  const inSchedule = await prisma.schedule.count({
    where: {
      facilityId,
      periodStart: { lte: date },
      periodEnd: { gte: date },
    },
  });
  if (inSchedule === 0) {
    return NextResponse.json(
      { error: "Datum liegt in keinem Planungszeitraum dieser Einrichtung." },
      { status: 400 },
    );
  }

  if (data.shiftProfileId) {
    const prof = await prisma.shiftProfile.findFirst({
      where: { id: data.shiftProfileId, facilityId },
    });
    if (!prof) {
      return NextResponse.json(
        { error: "Schichtprofil nicht gefunden." },
        { status: 400 },
      );
    }
    if (data.shiftType && prof.shiftType !== (data.shiftType as ShiftType)) {
      return NextResponse.json(
        { error: "shiftType passt nicht zum gewählten Schichtprofil." },
        { status: 400 },
      );
    }
  }

  try {
    const wish = await prisma.wish.create({
      data: {
        employeeId,
        date,
        shiftType: (data.shiftType as ShiftType | undefined) ?? undefined,
        shiftProfileId: data.shiftProfileId ?? undefined,
        priority: (data.priority as WishPriority | undefined) ?? WishPriority.NORMAL,
        note: data.note ?? undefined,
        status: WishStatus.OPEN,
      },
    });
    return NextResponse.json({ wish: serializeWish(wish) }, { status: 201 });
  } catch (e) {
    console.error("POST /api/wishes", e);
    return NextResponse.json(
      { error: "Wunsch konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }
}
