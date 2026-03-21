import type { Assignment, Employee, Schedule, ShiftProfile } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export type AssignmentWithRelations = Assignment & {
  employee: Employee;
  shiftProfile: ShiftProfile;
};

export async function fetchScheduleExportBundle(
  scheduleId: string,
  facilityId: string,
): Promise<{ schedule: Schedule; assignments: AssignmentWithRelations[] } | null> {
  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId },
  });
  if (!schedule) return null;

  const assignments = await prisma.assignment.findMany({
    where: { scheduleId },
    include: {
      employee: true,
      shiftProfile: true,
    },
    orderBy: [
      { date: "asc" },
      { employee: { lastName: "asc" } },
      { employee: { firstName: "asc" } },
    ],
  });

  return { schedule, assignments };
}
