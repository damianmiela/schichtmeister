import { NextRequest, NextResponse } from "next/server";
import {
  AssignmentOpRejected,
  assignmentFailureResponse,
} from "@/lib/api/assignmentHttp";
import { assignmentCreateBodySchema } from "@/lib/api/assignmentSchemas";
import {
  loadScheduleForFacility,
  requireActiveProfile,
  requireEmployee,
  validateNewAssignmentInTx,
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
  shiftProfileId: string | null;
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

export async function POST(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const parsed = await parseJsonBody(request, assignmentCreateBodySchema);
  if (!parsed.ok) return parsed.response;

  const date = parseIsoDateOnly(parsed.data.date);
  if (!date) {
    return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
  }

  const facilityId = session!.user.facilityId;
  const userId = session!.user.id;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const sched = await loadScheduleForFacility(tx, parsed.data.scheduleId, facilityId);
      if (!sched.ok) {
        throw new AssignmentOpRejected(sched.failure);
      }

      const prof = await requireActiveProfile(tx, parsed.data.shiftProfileId, facilityId);
      if (!prof.ok) throw new AssignmentOpRejected(prof.failure);

      const emp = await requireEmployee(tx, parsed.data.employeeId, facilityId);
      if (!emp.ok) throw new AssignmentOpRejected(emp.failure);

      if (!parsed.data.force) {
        const rules = await validateNewAssignmentInTx(tx, facilityId, sched.schedule, {
          date,
          shiftProfileId: parsed.data.shiftProfileId,
          employeeId: parsed.data.employeeId,
        });
        if (!rules.ok) throw new AssignmentOpRejected(rules.failure);
      }

      const row = await tx.assignment.create({
        data: {
          scheduleId: parsed.data.scheduleId,
          date,
          shiftProfileId: parsed.data.shiftProfileId,
          employeeId: parsed.data.employeeId,
          createdByUserId: userId,
          ...(parsed.data.stationNumber != null ? { stationNumber: parsed.data.stationNumber } : {}),
        },
      });
      await writeAuditLog(tx, {
        entityType: AUDIT_ENTITY_ASSIGNMENT,
        entityId: row.id,
        action: AuditAction.CREATE,
        actorUserId: userId,
        after: assignmentAuditSnapshot(row),
      });
      return row;
    });

    return NextResponse.json(
      { assignment: serializeAssignment(created) },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof AssignmentOpRejected) {
      return assignmentFailureResponse(e.failure);
    }
    console.error("POST /api/assignments", e);
    return NextResponse.json(
      { error: "Zuweisung konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }
}
