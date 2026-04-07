import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587/STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

interface MailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendMail({ to, subject, html }: MailOptions): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@example.com";

  if (!process.env.SMTP_HOST) {
    console.warn("[EMAIL] SMTP not configured — logging email to console:");
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body: ${html}`);
    return;
  }

  await transporter.sendMail({ from, to, subject, html });
}
