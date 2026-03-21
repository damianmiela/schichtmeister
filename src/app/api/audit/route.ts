import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auditListQuerySchema } from "@/lib/api/auditSchemas";
import { parseIsoDateOnly } from "@/lib/api/dateOnly";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

function endOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
  );
}

export async function GET(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = auditListQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Abfrageparameter." },
      { status: 400 },
    );
  }
  const q = parsed.data;

  const where: Prisma.AuditLogWhereInput = {
    actor: { facilityId: session!.user.facilityId },
  };
  if (q.entityType) where.entityType = q.entityType;
  if (q.entityId) where.entityId = q.entityId;

  if (q.from !== undefined || q.to !== undefined) {
    const range: Prisma.DateTimeFilter = {};
    if (q.from !== undefined) {
      const fromD = parseIsoDateOnly(q.from);
      if (!fromD) {
        return NextResponse.json({ error: "Ungültiges from-Datum." }, { status: 400 });
      }
      range.gte = fromD;
    }
    if (q.to !== undefined) {
      const toD = parseIsoDateOnly(q.to);
      if (!toD) {
        return NextResponse.json({ error: "Ungültiges to-Datum." }, { status: 400 });
      }
      range.lte = endOfUtcDay(toD);
    }
    where.createdAt = range;
  }

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: q.limit,
    include: { actor: { select: { email: true } } },
  });

  return NextResponse.json({
    entries: rows.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      before: r.before,
      after: r.after,
      actorUserId: r.actorUserId,
      actorEmail: r.actor.email,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
