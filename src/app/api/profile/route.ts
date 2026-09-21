import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { plannerJsonErrors, parseJsonBody } from "@/lib/api/validation";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

/** GET — get current user profile */
export async function GET() {
  const { session, error } = await requireAuth();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: { id: true, name: true, email: true, role: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Benutzer nicht gefunden" }, { status: 404 });
  }

  return NextResponse.json({ user });
}

const updateSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().transform((e) => e.trim().toLowerCase()).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).optional(),
});

/** PATCH — update own profile */
export async function PATCH(request: NextRequest) {
  const { session, error } = await requireAuth();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();

  // The shared demo login has to keep working for every visitor.
  if (session!.user.role === "DEMO") {
    return NextResponse.json(
      { error: "Im Demo-Zugang lassen sich Name, E-Mail und Passwort nicht ändern." },
      { status: 403 },
    );
  }

  const parsed = await parseJsonBody(request, updateSchema);
  if (!parsed.ok) return parsed.response;

  const { name, email, currentPassword, newPassword } = parsed.data;
  const userId = session!.user.id;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "Benutzer nicht gefunden" }, { status: 404 });
  }

  // If changing password, require current password
  if (newPassword) {
    if (!currentPassword) {
      return NextResponse.json({ error: "Aktuelles Passwort erforderlich" }, { status: 400 });
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Aktuelles Passwort ist falsch" }, { status: 400 });
    }
  }

  // Check email uniqueness if changing
  if (email && email !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "E-Mail bereits vergeben" }, { status: 409 });
    }
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (email) data.email = email;
  if (newPassword) data.passwordHash = await bcrypt.hash(newPassword, 10);

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, name: true, email: true, role: true },
  });

  return NextResponse.json({ user: updated });
}
