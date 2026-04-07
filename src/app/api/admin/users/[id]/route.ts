import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { plannerJsonErrors, parseJsonBody } from "@/lib/api/validation";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

type RouteCtx = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  email: z.string().email().transform((e) => e.trim().toLowerCase()).optional(),
  password: z.string().min(8).optional(),
  role: z.enum(["ADMIN", "PLANNER", "EMPLOYEE"]).optional(),
  employeeId: z.string().nullable().optional(),
});

/** PATCH — update user */
export async function PATCH(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requireAdmin();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const facilityId = session!.user.facilityId;

  const user = await prisma.user.findFirst({ where: { id, facilityId } });
  if (!user) {
    return NextResponse.json({ error: "Benutzer nicht gefunden" }, { status: 404 });
  }

  const parsed = await parseJsonBody(request, updateSchema);
  if (!parsed.ok) return parsed.response;

  const { email, password, role, employeeId } = parsed.data;

  // Prevent demoting yourself
  if (id === session!.user.id && role && role !== "ADMIN") {
    return NextResponse.json(
      { error: "Sie können Ihre eigene Rolle nicht ändern" },
      { status: 400 },
    );
  }

  // Check email uniqueness if changing
  if (email && email !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "E-Mail bereits vergeben" }, { status: 409 });
    }
  }

  // If employeeId provided, verify
  if (employeeId !== undefined && employeeId !== null) {
    const emp = await prisma.employee.findFirst({ where: { id: employeeId, facilityId } });
    if (!emp) {
      return NextResponse.json({ error: "Mitarbeiter nicht gefunden" }, { status: 400 });
    }
    const linkedUser = await prisma.user.findUnique({ where: { employeeId } });
    if (linkedUser && linkedUser.id !== id) {
      return NextResponse.json({ error: "Mitarbeiter bereits verknüpft" }, { status: 409 });
    }
  }

  const data: Record<string, unknown> = {};
  if (email) data.email = email;
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  if (role) data.role = role;
  if (employeeId !== undefined) data.employeeId = employeeId;

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, role: true, employeeId: true, createdAt: true },
  });

  return NextResponse.json({ user: updated });
}

/** DELETE — remove user */
export async function DELETE(_request: NextRequest, context: RouteCtx) {
  const { session, error } = await requireAdmin();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const facilityId = session!.user.facilityId;

  // Prevent self-deletion
  if (id === session!.user.id) {
    return NextResponse.json(
      { error: "Sie können sich nicht selbst löschen" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findFirst({ where: { id, facilityId } });
  if (!user) {
    return NextResponse.json({ error: "Benutzer nicht gefunden" }, { status: 404 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
