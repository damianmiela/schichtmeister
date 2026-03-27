import {
  PrismaClient,
  ContractType,
  ShiftType,
  UserRole,
  TargetHoursPeriod,
  ScheduleStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { monthlyTargetHoursFromPercent } from "../src/lib/employeeContractDenorm";

const prisma = new PrismaClient();

/** Dev-only default; override with SEED_ADMIN_PASSWORD for non-local runs */
const seedPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin";

async function main() {
  await prisma.auditLog.deleteMany();
  await prisma.swapRequest.deleteMany();
  await prisma.wish.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.staffingRequirement.deleteMany();
  await prisma.shiftProfile.deleteMany();
  await prisma.employeeAvailability.deleteMany();
  await prisma.user.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.facility.deleteMany();

  const facility = await prisma.facility.create({
    data: {
      name: "Demo-Einrichtung (Demo)",
      minRestHours: 11,
      miniJobMaxMonthlyHours: 520,
    },
  });

  const passwordHash = bcrypt.hashSync(seedPassword, 10);

  const planner = await prisma.user.create({
    data: {
      email: "planner@schichtmeister.local",
      passwordHash,
      role: UserRole.PLANNER,
      facilityId: facility.id,
    },
  });

  const empAnna = await prisma.employee.create({
    data: {
      facilityId: facility.id,
      firstName: "Anna",
      lastName: "Schmidt",
      contractType: ContractType.FULL_TIME,
      targetHours: 173.33,
      targetHoursPeriod: TargetHoursPeriod.MONTHLY,
      targetHoursPercent: 100,
      qualificationTags: ["NurseQualified"],
      preferredShiftTypes: [ShiftType.EARLY],
    },
  });

  const empBen = await prisma.employee.create({
    data: {
      facilityId: facility.id,
      firstName: "Ben",
      lastName: "Müller",
      contractType: ContractType.PART_TIME,
      targetHours: 130,
      targetHoursPeriod: TargetHoursPeriod.MONTHLY,
      targetHoursPercent: 75,
      qualificationTags: ["Hilfskraft"],
    },
  });

  await prisma.employee.create({
    data: {
      facilityId: facility.id,
      firstName: "Chris",
      lastName: "Weber",
      contractType: ContractType.MINI_JOB,
      targetHours: monthlyTargetHoursFromPercent(50),
      targetHoursPeriod: TargetHoursPeriod.MONTHLY,
      targetHoursPercent: 50,
      miniJobMaxMonthlyHours: 80,
      qualificationTags: ["Hilfskraft"],
    },
  });

  await prisma.user.create({
    data: {
      email: "employee@schichtmeister.local",
      passwordHash,
      role: UserRole.EMPLOYEE,
      facilityId: facility.id,
      employeeId: empAnna.id,
    },
  });

  const shiftTypePrefix: Record<ShiftType, string> = {
    [ShiftType.EARLY]: "F",
    [ShiftType.LATE]: "S",
    [ShiftType.NIGHT]: "N",
  };
  const shiftTimings: Record<ShiftType, { startTime: string; endTime: string; breakMinutes: number }> = {
    [ShiftType.EARLY]: { startTime: "06:00", endTime: "14:30", breakMinutes: 30 },
    [ShiftType.LATE]: { startTime: "14:00", endTime: "22:00", breakMinutes: 30 },
    [ShiftType.NIGHT]: { startTime: "21:30", endTime: "06:30", breakMinutes: 30 },
  };

  const profiles: Record<string, { id: string }> = {};
  for (const shiftType of Object.values(ShiftType)) {
    for (const station of [1, 2, 3]) {
      const name = `${shiftTypePrefix[shiftType]}${station}`;
      const p = await prisma.shiftProfile.create({
        data: {
          facilityId: facility.id,
          name,
          shiftType,
          stationNumber: station,
          ...shiftTimings[shiftType],
        },
      });
      profiles[name] = p;
    }
  }
  const early = profiles["F1"];

  type StationStaffing = {
    minTotalCount: number;
    qualifications: { tag: string; minCount: number }[];
  };
  const perShiftStation: Record<ShiftType, StationStaffing[]> = {
    [ShiftType.EARLY]: [
      { minTotalCount: 3, qualifications: [{ tag: "NurseQualified", minCount: 1 }] },
      { minTotalCount: 3, qualifications: [{ tag: "NurseQualified", minCount: 1 }] },
      { minTotalCount: 2, qualifications: [{ tag: "NurseQualified", minCount: 1 }] },
    ],
    [ShiftType.LATE]: [
      { minTotalCount: 2, qualifications: [] },
      { minTotalCount: 2, qualifications: [] },
      { minTotalCount: 2, qualifications: [] },
    ],
    [ShiftType.NIGHT]: [
      { minTotalCount: 1, qualifications: [{ tag: "NurseQualified", minCount: 1 }] },
      { minTotalCount: 1, qualifications: [] },
      { minTotalCount: 1, qualifications: [] },
    ],
  };

  for (const shiftType of Object.values(ShiftType)) {
    for (const station of [1, 2, 3]) {
      const cfg = perShiftStation[shiftType][station - 1];
      await prisma.staffingRequirement.create({
        data: {
          facilityId: facility.id,
          shiftType,
          stationNumber: station,
          minTotalCount: cfg.minTotalCount,
          qualificationRequirements: {
            create: cfg.qualifications.map((q) => ({
              qualificationTag: q.tag,
              minCount: q.minCount,
            })),
          },
        },
      });
    }
  }

  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  const schedule = await prisma.schedule.create({
    data: {
      facilityId: facility.id,
      periodStart,
      periodEnd,
      status: ScheduleStatus.DRAFT,
    },
  });

  await prisma.assignment.create({
    data: {
      scheduleId: schedule.id,
      date: periodStart,
      shiftProfileId: early.id,
      employeeId: empBen.id,
      createdByUserId: planner.id,
    },
  });

  console.log("Seed OK:", {
    facilityId: facility.id,
    logins: ["planner@schichtmeister.local", "employee@schichtmeister.local"],
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
