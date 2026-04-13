import { describe, expect, it, vi } from "vitest";
import { AuditAction } from "@prisma/client";
import {
  assignmentAuditSnapshot,
  AUDIT_ENTITY_ASSIGNMENT,
  writeAuditLog,
} from "@/lib/audit";

describe("writeAuditLog", () => {
  it("creates an audit row with the given payload", async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = { auditLog: { create } };
    await writeAuditLog(db, {
      entityType: AUDIT_ENTITY_ASSIGNMENT,
      entityId: "asg_1",
      action: AuditAction.CREATE,
      actorUserId: "user_1",
      after: { id: "asg_1", scheduleId: "sch_1" },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      entityType: AUDIT_ENTITY_ASSIGNMENT,
      entityId: "asg_1",
      action: AuditAction.CREATE,
      actor: { connect: { id: "user_1" } },
      after: { id: "asg_1", scheduleId: "sch_1" },
    });
  });
});

describe("assignmentAuditSnapshot", () => {
  it("serializes date as ISO date-only", () => {
    const d = new Date("2026-03-15T00:00:00.000Z");
    expect(
      assignmentAuditSnapshot({
        id: "a",
        scheduleId: "s",
        date: d,
        shiftProfileId: "p",
        employeeId: "e",
      }),
    ).toEqual({
      id: "a",
      scheduleId: "s",
      date: "2026-03-15",
      shiftProfileId: "p",
      employeeId: "e",
    });
  });
});
