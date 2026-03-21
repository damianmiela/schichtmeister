import {
  PrismaClient,
  ContractType,
  ShiftType,
  UserRole,
  TargetHoursPeriod,
  ScheduleStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";

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

  const early = await prisma.shiftProfile.create({
    data: {
      facilityId: facility.id,
      name: "Early_100",
      shiftType: ShiftType.EARLY,
      startTime: "06:00",
      endTime: "14:30",
      breakMinutes: 30,
    },
  });

  await prisma.shiftProfile.create({
    data: {
      facilityId: facility.id,
      name: "Late_100",
      shiftType: ShiftType.LATE,
      startTime: "14:00",
      endTime: "22:00",
      breakMinutes: 30,
    },
  });

  await prisma.shiftProfile.create({
    data: {
      facilityId: facility.id,
      name: "Night",
      shiftType: ShiftType.NIGHT,
      startTime: "21:30",
      endTime: "06:30",
      breakMinutes: 30,
    },
  });

  // dayOfWeek: 0 = Sunday … 6 = Saturday (same as Date.getDay())
  const perShift: Record<
    ShiftType,
    { minStaffCount: number; requiredQualificationTags: string[] }
  > = {
    [ShiftType.EARLY]: { minStaffCount: 4, requiredQualificationTags: ["NurseQualified"] },
    [ShiftType.LATE]: { minStaffCount: 3, requiredQualificationTags: [] },
    [ShiftType.NIGHT]: { minStaffCount: 2, requiredQualificationTags: ["NurseQualified"] },
  };

  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
    for (const shiftType of Object.values(ShiftType)) {
      const cfg = perShift[shiftType];
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const minStaffCount =
        shiftType === ShiftType.LATE && isWeekend ? 2 : cfg.minStaffCount;

      await prisma.staffingRequirement.create({
        data: {
          facilityId: facility.id,
          dayOfWeek,
          shiftType,
          minStaffCount,
          requiredQualificationTags: cfg.requiredQualificationTags,
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
