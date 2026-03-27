import { NextRequest, NextResponse } from "next/server";
import { Prisma, ShiftType } from "@prisma/client";
import { z } from "zod";
import { shiftTypeZ } from "@/lib/api/employeeSchemas";
import { hhmmSchema, parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { autoProfileName } from "@/lib/schedule/stationHelpers";

const stationNumberZ = z.number().int().min(1).max(3);

const createSchema = z.object({
  shiftType: shiftTypeZ,
  stationNumber: stationNumberZ,
  startTime: hhmmSchema,
  endTime: hhmmSchema,
  breakMinutes: z.number().int().min(0).max(24 * 60).optional(),
  isActive: z.boolean().optional(),
});

function serialize(p: {
  id: string;
  name: string;
  shiftType: ShiftType;
  stationNumber: number;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isActive: boolean;
  createdAt: Date;
}) {
  return {
    id: p.id,
    name: p.name,
    shiftType: p.shiftType,
    stationNumber: p.stationNumber,
    startTime: p.startTime,
    endTime: p.endTime,
    breakMinutes: p.breakMinutes,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const raw = request.nextUrl.searchParams.get("isActive");
  const where: Prisma.ShiftProfileWhereInput = {
    facilityId: session!.user.facilityId,
  };
  if (raw === "true") where.isActive = true;
  if (raw === "false") where.isActive = false;

  const profiles = await prisma.shiftProfile.findMany({
    where,
    orderBy: [{ stationNumber: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({
    shiftProfiles: profiles.map(serialize),
  });
}

export async function POST(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;
  const name = autoProfileName(data.shiftType as ShiftType, data.stationNumber);
  try {
    const profile = await prisma.shiftProfile.create({
      data: {
        facilityId: session!.user.facilityId,
        name,
        shiftType: data.shiftType as ShiftType,
        stationNumber: data.stationNumber,
        startTime: data.startTime,
        endTime: data.endTime,
        breakMinutes: data.breakMinutes ?? 0,
        isActive: data.isActive ?? true,
      },
    });
    return NextResponse.json({ shiftProfile: serialize(profile) }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Für diesen Schichttyp und Station existiert bereits ein Profil." },
        { status: 409 },
      );
    }
    console.error("POST /api/shift-profiles", e);
    return NextResponse.json(
      { error: "Schichtprofil konnte nicht angelegt werden." },
      { status: 500 },
    );
  }
}
