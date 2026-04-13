import { NextRequest, NextResponse } from "next/server";
import {
  AssignmentOpRejected,
  assignmentFailureResponse,
} from "@/lib/api/assignmentHttp";
import { assignmentPatchBodySchema } from "@/lib/api/assignmentSchemas";
import {
  loadScheduleForFacility,
  requireActiveProfile,
  requireEmployee,
  validatePatchedAssignmentInTx,
} from "@/lib/api/assignmentMutations";
import { parseIsoDateOnly, toIsoDateOnly } from "@/lib/api/dateOnly";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import {
  assignmentAuditSnapshot,
  AUDIT_ENTITY_ASSIGNMENT,
  AuditAction,
  writeAuditLog,
} from "@/lib/audit";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

function serializeAssignment(a: {
  id: string;
  scheduleId: string;
  date: Date;
  shiftProfileId: string;
  employeeId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: a.id,
    scheduleId: a.scheduleId,
    date: toIsoDateOnly(a.date),
    shiftProfileId: a.shiftProfileId,
    employeeId: a.employeeId,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id: assignmentId } = await context.params;
  const parsed = await parseJsonBody(request, assignmentPatchBodySchema);
  if (!parsed.ok) return parsed.response;

  const facilityId = session!.user.facilityId;
  let patchDate: Date | undefined;
  if (parsed.data.date !== undefined) {
    const d = parseIsoDateOnly(parsed.data.date);
    if (!d) {
      return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
    }
    patchDate = d;
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.assignment.findFirst({
        where: { id: assignmentId },
        include: { schedule: true },
      });
      if (!row || row.schedule.facilityId !== facilityId) {
        throw new AssignmentOpRejected({
          kind: "http",
          status: 404,
          error: "Zuweisung nicht gefunden.",
        });
      }

      const sched = await loadScheduleForFacility(tx, row.scheduleId, facilityId);
      if (!sched.ok) throw new AssignmentOpRejected(sched.failure);

      if (parsed.data.shiftProfileId !== undefined) {
        const prof = await requireActiveProfile(tx, parsed.data.shiftProfileId, facilityId);
        if (!prof.ok) throw new AssignmentOpRejected(prof.failure);
      }

      if (parsed.data.employeeId !== undefined) {
        const emp = await requireEmployee(tx, parsed.data.employeeId, facilityId);
        if (!emp.ok) throw new AssignmentOpRejected(emp.failure);
      }

      const rules = await validatePatchedAssignmentInTx(
        tx,
        facilityId,
        sched.schedule,
        assignmentId,
        {
          ...(parsed.data.date !== undefined && { date: patchDate }),
          ...(parsed.data.shiftProfileId !== undefined && {
            shiftProfileId: parsed.data.shiftProfileId,
          }),
          ...(parsed.data.employeeId !== undefined && {
            employeeId: parsed.data.employeeId,
          }),
        },
      );
      if (!rules.ok) throw new AssignmentOpRejected(rules.failure);

      const data: {
        date?: Date;
        shiftProfileId?: string;
        employeeId?: string;
      } = {};
      if (parsed.data.date !== undefined) data.date = patchDate;
      if (parsed.data.shiftProfileId !== undefined) {
        data.shiftProfileId = parsed.data.shiftProfileId;
      }
      if (parsed.data.employeeId !== undefined) {
        data.employeeId = parsed.data.employeeId;
      }

      const beforeSnap = assignmentAuditSnapshot(row);

      const updated = await tx.assignment.update({
        where: { id: assignmentId },
        data,
      });

      await writeAuditLog(tx, {
        entityType: AUDIT_ENTITY_ASSIGNMENT,
        entityId: assignmentId,
        action: AuditAction.UPDATE,
        actorUserId: session!.user.id,
        before: beforeSnap,
        after: assignmentAuditSnapshot(updated),
      });

      return updated;
    });

    return NextResponse.json({ assignment: serializeAssignment(updated) });
  } catch (e) {
    if (e instanceof AssignmentOpRejected) {
      return assignmentFailureResponse(e.failure);
    }
    console.error("PATCH /api/assignments/[id]", e);
    return NextResponse.json(
      { error: "Aktualisierung fehlgeschlagen." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id: assignmentId } = await context.params;
  const facilityId = session!.user.facilityId;

  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.assignment.findFirst({
        where: { id: assignmentId },
        include: { schedule: true },
      });
      if (!row || row.schedule.facilityId !== facilityId) {
        throw new AssignmentOpRejected({
          kind: "http",
          status: 404,
          error: "Zuweisung nicht gefunden.",
        });
      }
      await writeAuditLog(tx, {
        entityType: AUDIT_ENTITY_ASSIGNMENT,
        entityId: assignmentId,
        action: AuditAction.DELETE,
        actorUserId: session!.user.id,
        before: assignmentAuditSnapshot(row),
      });
      await tx.assignment.delete({ where: { id: assignmentId } });
    });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof AssignmentOpRejected) {
      return assignmentFailureResponse(e.failure);
    }
    console.error("DELETE /api/assignments/[id]", e);
    return NextResponse.json({ error: "Löschen fehlgeschlagen." }, { status: 500 });
  }
}
