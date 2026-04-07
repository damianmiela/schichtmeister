import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { plannerJsonErrors, parseJsonBody } from "@/lib/api/validation";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

/** GET — list all users in the facility */
export async function GET() {
  const { session, error } = await requireAdmin();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const facilityId = session!.user.facilityId;
  const users = await prisma.user.findMany({
    where: { facilityId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      lastActiveAt: true,
      createdAt: true,
    },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });

  return NextResponse.json({ users });
}

const createSchema = z.object({
  name: z.string().optional().default(""),
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
  password: z.string().min(8, "Mindestens 8 Zeichen"),
  role: z.enum(["ADMIN", "PLANNER", "DEMO"]),
});

/** POST — create a new user */
export async function POST(request: NextRequest) {
  const { session, error } = await requireAdmin();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;

  const { name, email, password, role } = parsed.data;
  const facilityId = session!.user.facilityId;

  // Check email uniqueness
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "E-Mail bereits vergeben" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role,
      facilityId,
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  return NextResponse.json({ user }, { status: 201 });
}
