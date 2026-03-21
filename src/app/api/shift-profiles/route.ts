import { NextRequest, NextResponse } from "next/server";
import { ContractType, Prisma, ShiftType } from "@prisma/client";
import { z } from "zod";
import { contractTypeZ, shiftTypeZ } from "@/lib/api/employeeSchemas";
import { hhmmSchema, parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  shiftType: shiftTypeZ,
  startTime: hhmmSchema,
  endTime: hhmmSchema,
  breakMinutes: z.number().int().min(0).max(24 * 60).optional(),
  isActive: z.boolean().optional(),
  targetHoursPercent: z.number().positive().max(1000).optional(),
  contractType: contractTypeZ.optional(),
  miniJobMaxMonthlyHours: z.number().positive().optional().nullable(),
});

function serialize(p: {
  id: string;
  name: string;
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isActive: boolean;
  targetHoursPercent: { toString(): string } | number;
  contractType: ContractType;
  miniJobMaxMonthlyHours: { toString(): string } | null;
  createdAt: Date;
}) {
  return {
    id: p.id,
    name: p.name,
    shiftType: p.shiftType,
    startTime: p.startTime,
    endTime: p.endTime,
    breakMinutes: p.breakMinutes,
    isActive: p.isActive,
    targetHoursPercent: Number(p.targetHoursPercent),
    contractType: p.contractType,
    miniJobMaxMonthlyHours:
      p.miniJobMaxMonthlyHours != null ? Number(p.miniJobMaxMonthlyHours) : null,
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
    orderBy: [{ name: "asc" }],
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
  try {
    const profile = await prisma.shiftProfile.create({
      data: {
        facilityId: session!.user.facilityId,
        name: data.name.trim(),
        shiftType: data.shiftType as ShiftType,
        startTime: data.startTime,
        endTime: data.endTime,
        breakMinutes: data.breakMinutes ?? 0,
        isActive: data.isActive ?? true,
        targetHoursPercent: data.targetHoursPercent ?? 100,
        contractType: (data.contractType ?? ContractType.FULL_TIME) as ContractType,
        miniJobMaxMonthlyHours:
          data.miniJobMaxMonthlyHours === undefined
            ? undefined
            : data.miniJobMaxMonthlyHours,
      },
    });
    return NextResponse.json({ shiftProfile: serialize(profile) }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Ein Schichtprofil mit diesem Namen existiert bereits." },
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
