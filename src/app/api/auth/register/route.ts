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

    // Fresh DB after migrate has no rows; seed is optional and destructive. Create default facility on first registration.
    const facility = await prisma.$transaction(async (tx) => {
      const existing = await tx.facility.findFirst({
        orderBy: { createdAt: "asc" },
      });
      if (existing) return existing;
      const name =
        process.env.DEFAULT_FACILITY_NAME?.trim() || "Demo-Einrichtung";
      return tx.facility.create({
        data: { name },
      });
    });

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
    const message = e instanceof Error ? e.message : String(e);
    console.error("POST /api/auth/register", message, e);
    const hint =
      message.includes("Prisma") || message.includes("libssl") || message.includes("openssl")
        ? " (Prisma/DB engine — check Docker image OpenSSL / prisma binaryTargets)"
        : "";
    return NextResponse.json(
      {
        error: "Registrierung fehlgeschlagen.",
        ...(process.env.NODE_ENV !== "production" && { debug: message + hint }),
      },
      { status: 500 }
    );
  }
}
