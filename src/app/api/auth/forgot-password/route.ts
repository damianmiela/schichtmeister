import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";
import { sendMail } from "@/lib/email/sendMail";

const schema = z.object({
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
});

const TOKEN_EXPIRY_HOURS = 1;

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Ungültige E-Mail-Adresse" }, { status: 400 });
    }

    const { email } = parsed.data;

    // Always return success to prevent email enumeration
    const successResponse = NextResponse.json({
      message: "Falls ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet.",
    });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return successResponse;

    // Rate limit: max 3 tokens per user per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentTokens = await prisma.passwordResetToken.count({
      where: { userId: user.id, createdAt: { gte: oneHourAgo } },
    });
    if (recentTokens >= 3) return successResponse;

    // Generate secure token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    await prisma.passwordResetToken.create({
      data: { token, userId: user.id, expiresAt },
    });

    // Build reset link
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    await sendMail({
      to: email,
      subject: "Passwort zurücksetzen — SchichtMeister",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #1565c0;">Passwort zurücksetzen</h2>
          <p>Sie haben angefordert, Ihr Passwort zurückzusetzen.</p>
          <p>Klicken Sie auf den folgenden Link, um ein neues Passwort zu vergeben:</p>
          <p style="margin: 24px 0;">
            <a href="${resetUrl}"
               style="background: #1565c0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Passwort zurücksetzen
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            Dieser Link ist ${TOKEN_EXPIRY_HOURS} Stunde gültig.
            Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px;">SchichtMeister</p>
        </div>
      `,
    });

    return successResponse;
  } catch (e) {
    console.error("POST /api/auth/forgot-password", e);
    return NextResponse.json({ error: "Ein Fehler ist aufgetreten." }, { status: 500 });
  }
}
