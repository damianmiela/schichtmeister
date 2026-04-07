import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Passwort mindestens 8 Zeichen"),
});

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ungültige Eingabe", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { token, password } = parsed.data;

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken) {
      return NextResponse.json(
        { error: "Ungültiger oder abgelaufener Link." },
        { status: 400 },
      );
    }

    if (resetToken.usedAt) {
      return NextResponse.json(
        { error: "Dieser Link wurde bereits verwendet." },
        { status: 400 },
      );
    }

    if (resetToken.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "Dieser Link ist abgelaufen. Bitte fordern Sie einen neuen an." },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ message: "Passwort erfolgreich geändert." });
  } catch (e) {
    console.error("POST /api/auth/reset-password", e);
    return NextResponse.json({ error: "Ein Fehler ist aufgetreten." }, { status: 500 });
  }
}
