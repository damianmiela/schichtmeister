import type { Assignment, Employee, Schedule, ShiftProfile } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export type AssignmentWithRelations = Assignment & {
  employee: Employee;
  shiftProfile: ShiftProfile;
};

export type ExportQualification = {
  id: string;
  abbreviation: string;
  color: string | null;
  sortOrder: number;
};

export type ExportBundle = {
  schedule: Schedule;
  assignments: AssignmentWithRelations[];
  facilityName: string;
  allEmployees: Employee[];
  qualificationsByEmployee: Map<string, ExportQualification[]>;
};

export async function fetchScheduleExportBundle(
  scheduleId: string,
  facilityId: string,
): Promise<ExportBundle | null> {
  const [schedule, facility] = await Promise.all([
    prisma.schedule.findFirst({ where: { id: scheduleId, facilityId } }),
    prisma.facility.findFirst({ where: { id: facilityId }, select: { name: true } }),
  ]);
  if (!schedule || !facility) return null;

  const [assignments, allEmployees, employeesWithQuals] = await Promise.all([
    prisma.assignment.findMany({
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
    }),
    prisma.employee.findMany({
      where: { facilityId, status: "ACTIVE" },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.employee.findMany({
      where: { facilityId, status: "ACTIVE" },
      select: {
        id: true,
        qualifications: {
          select: { id: true, abbreviation: true, color: true, sortOrder: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    }),
  ]);

  const qualificationsByEmployee = new Map<string, ExportQualification[]>();
  for (const e of employeesWithQuals) {
    qualificationsByEmployee.set(e.id, e.qualifications as ExportQualification[]);
  }

  return { schedule, assignments, facilityName: facility.name, allEmployees, qualificationsByEmployee };
}
