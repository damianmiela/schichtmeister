import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { UserRole } from "@prisma/client";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Passwort mindestens 8 Zeichen"),
});

export async function POST(request: NextRequest) {
  if (process.env.ALLOW_PUBLIC_REGISTRATION === "false") {
    return NextResponse.json(
      { error: "Registrierung ist deaktiviert." },
      { status: 403 }
    );
  }

  try {
    const json = await request.json();
    const parsed = registerSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ungültige Eingabe", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const email = parsed.data.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "Diese E-Mail ist bereits registriert." },
        { status: 409 }
      );
    }

    const facility = await prisma.facility.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (!facility) {
      return NextResponse.json(
        { error: "Keine Einrichtung in der Datenbank. Bitte Seed/Migration ausführen." },
        { status: 503 }
      );
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);

    await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: UserRole.PLANNER,
        facilityId: facility.id,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("register", e);
    return NextResponse.json(
      { error: "Registrierung fehlgeschlagen." },
      { status: 500 }
    );
  }
}
