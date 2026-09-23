import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Prisma,
  PrismaClient,
  UserRole,
  type ContractType,
  type EmployeeStatus,
  type ScheduleStatus,
  type ShiftType,
  type TargetHoursPeriod,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/** Dev-only default; override with SEED_ADMIN_PASSWORD for non-local runs */
const seedPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin";

/**
 * prisma/demo-data.json: the setup of a real care home (shift profiles, staffing
 * rules, qualifications, 45 employees with their contracts) and its plans for
 * January to September 2026. The names are made up; logins, notes and logs were
 * left out when the data was exported.
 */
type DemoData = {
  facility: {
    id: string;
    minRestHours: number;
    miniJobMaxMonthlyHours: number;
    maxSolveTimeSeconds: number;
    ruleOverridesJson: string | null;
    solverWeightsJson: string | null;
  };
  qualifications: {
    id: string;
    name: string;
    abbreviation: string;
    color: string | null;
    isActive: boolean;
    sortOrder: number;
  }[];
  workProfiles: {
    id: string;
    name: string;
    targetHoursPercent: number;
    contractType: ContractType;
    miniJobMaxMonthlyHours: number | null;
  }[];
  shiftProfiles: {
    id: string;
    name: string;
    shiftType: ShiftType;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    startTime2: string | null;
    endTime2: string | null;
    breakMinutes2: number | null;
    isActive: boolean;
  }[];
  shiftMarkings: { id: string; code: string; label: string; color: string; sortOrder: number }[];
  staffingRequirements: {
    id: string;
    shiftType: ShiftType;
    stationNumber: number;
    minTotalCount: number;
    maxTotalCount: number | null;
    isFacilityWide: boolean;
  }[];
  qualificationRequirements: {
    id: string;
    staffingRequirementId: string;
    qualificationTag: string;
    minCount: number;
    maxCount: number | null;
  }[];
  employees: {
    id: string;
    firstName: string;
    lastName: string;
    contractType: ContractType;
    targetHours: number | null;
    targetHoursPeriod: TargetHoursPeriod | null;
    miniJobMaxMonthlyHours: number | null;
    targetHoursPercent: number | null;
    workProfileId: string | null;
    mainStation: number | null;
    assignedStations: number[];
    status: EmployeeStatus;
    qualificationTags: string[];
    preferredShiftTypes: ShiftType[];
    isFullTimeBl: boolean;
    fixedWorkingDays: number[];
    maxConsecutiveDays: number | null;
    shiftDistribution: Prisma.InputJsonValue | null;
    qualificationIds: string[];
    allowedShiftProfileIds: string[];
  }[];
  demoLoginEmployeeId: string;
  schedules: {
    id: string;
    periodStart: string;
    periodEnd: string;
    status: ScheduleStatus;
    publishedAt: string | null;
  }[];
  assignments: {
    id: string;
    scheduleId: string;
    date: string;
    employeeId: string;
    shiftProfileId?: string;
    stationNumber?: number;
    markingRow2?: string;
    markingRow3?: string;
    dayStatus?: string;
  }[];
};

const data = JSON.parse(
  readFileSync(path.join(process.cwd(), "prisma", "demo-data.json"), "utf8"),
) as DemoData;

async function main() {
  await prisma.auditLog.deleteMany();
  await prisma.swapRequest.deleteMany();
  await prisma.wish.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.qualificationRequirement.deleteMany();
  await prisma.staffingRequirement.deleteMany();
  await prisma.employeeAbsence.deleteMany();
  await prisma.shiftProfile.deleteMany();
  await prisma.employeeAvailability.deleteMany();
  await prisma.user.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.qualification.deleteMany();
  await prisma.facility.deleteMany(); // also removes work profiles and shift markings

  const facilityId = data.facility.id;
  await prisma.facility.create({ data: { ...data.facility, name: "Demo-Einrichtung" } });
  await prisma.qualification.createMany({
    data: data.qualifications.map((q) => ({ ...q, facilityId })),
  });
  await prisma.employeeWorkProfile.createMany({
    data: data.workProfiles.map((w) => ({ ...w, facilityId })),
  });
  await prisma.shiftProfile.createMany({
    data: data.shiftProfiles.map((s) => ({ ...s, facilityId })),
  });
  await prisma.shiftMarking.createMany({
    data: data.shiftMarkings.map((m) => ({ ...m, facilityId })),
  });
  await prisma.staffingRequirement.createMany({
    data: data.staffingRequirements.map((r) => ({ ...r, facilityId })),
  });
  await prisma.qualificationRequirement.createMany({ data: data.qualificationRequirements });

  for (const { qualificationIds, allowedShiftProfileIds, shiftDistribution, ...employee } of data.employees) {
    await prisma.employee.create({
      data: {
        ...employee,
        facilityId,
        shiftDistribution: shiftDistribution ?? Prisma.DbNull,
        qualifications: { connect: qualificationIds.map((id) => ({ id })) },
        allowedShiftProfiles: { connect: allowedShiftProfileIds.map((id) => ({ id })) },
      },
    });
  }

  const passwordHash = bcrypt.hashSync(seedPassword, 10);
  const admin = await prisma.user.create({
    data: { email: "admin@schichtmeister.local", passwordHash, role: UserRole.ADMIN, facilityId },
  });
  await prisma.user.create({
    data: { email: "planner@schichtmeister.local", passwordHash, role: UserRole.PLANNER, facilityId },
  });
  await prisma.user.create({
    data: {
      email: "employee@schichtmeister.local",
      passwordHash,
      role: UserRole.DEMO,
      facilityId,
      employeeId: data.demoLoginEmployeeId,
    },
  });

  await prisma.schedule.createMany({
    data: data.schedules.map((s) => ({
      ...s,
      facilityId,
      periodStart: new Date(s.periodStart),
      periodEnd: new Date(s.periodEnd),
      publishedAt: s.publishedAt ? new Date(s.publishedAt) : null,
    })),
  });
  await prisma.assignment.createMany({
    data: data.assignments.map((a) => ({ ...a, date: new Date(a.date), createdByUserId: admin.id })),
  });

  console.log("Seed OK:", {
    facility: "Demo-Einrichtung",
    employees: data.employees.length,
    schedules: data.schedules.length,
    assignments: data.assignments.length,
    logins: ["admin@schichtmeister.local", "planner@schichtmeister.local", "employee@schichtmeister.local"],
    passwordNote:
      seedPassword === "admin"
        ? "default password: admin (set SEED_ADMIN_PASSWORD to override)"
        : "password from SEED_ADMIN_PASSWORD",
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
