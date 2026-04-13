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
  await prisma.qualificationRequirement.deleteMany();
  await prisma.staffingRequirement.deleteMany();
  await prisma.employeeAbsence.deleteMany();
  await prisma.shiftProfile.deleteMany();
  await prisma.employeeAvailability.deleteMany();
  await prisma.user.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.qualification.deleteMany();
  await prisma.facility.deleteMany();

  const facility = await prisma.facility.create({
    data: {
      name: "Demo-Einrichtung (Demo)",
      minRestHours: 11,
      miniJobMaxMonthlyHours: 520,
    },
  });

  // ── Qualifications ──
  const qualDefs = [
    { name: "Pflegedienstleitung", abbreviation: "PDL", sortOrder: 1 },
    { name: "Wohnbereichsleitung", abbreviation: "WBL", sortOrder: 2 },
    { name: "Pflegefachkraft", abbreviation: "PFK", sortOrder: 3 },
    { name: "Altenpflegehelfer", abbreviation: "APH", sortOrder: 4 },
    { name: "Krankenpflegehelfer", abbreviation: "KPH", sortOrder: 5 },
    { name: "Pflegehilfskraft", abbreviation: "PH", sortOrder: 6 },
    { name: "Einarbeitung", abbreviation: "EA", sortOrder: 7 },
  ];
  const qualMap: Record<string, string> = {};
  for (const q of qualDefs) {
    const created = await prisma.qualification.create({
      data: { facilityId: facility.id, ...q },
    });
    qualMap[q.abbreviation] = created.id;
  }

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
      qualificationTags: ["PFK"],
      preferredShiftTypes: [ShiftType.EARLY],
      qualifications: { connect: [{ id: qualMap["PFK"]! }] },
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
      qualificationTags: ["APH"],
      qualifications: { connect: [{ id: qualMap["APH"]! }] },
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
      qualificationTags: ["PH"],
      qualifications: { connect: [{ id: qualMap["PH"]! }] },
    },
  });

  await prisma.user.create({
    data: {
      email: "employee@schichtmeister.local",
      passwordHash,
      role: UserRole.DEMO,
      facilityId: facility.id,
      employeeId: empAnna.id,
    },
  });

  // ── Shift Profiles (14 official profiles) ──
  const profileDefs: {
    name: string; shiftType: ShiftType; startTime: string; endTime: string;
    breakMinutes: number; startTime2?: string; endTime2?: string; breakMinutes2?: number;
  }[] = [
    { name: "F1", shiftType: ShiftType.EARLY, startTime: "06:00", endTime: "13:30", breakMinutes: 30 },
    { name: "F2", shiftType: ShiftType.EARLY, startTime: "06:00", endTime: "14:30", breakMinutes: 30 },
    { name: "F3", shiftType: ShiftType.EARLY, startTime: "06:00", endTime: "13:00", breakMinutes: 30 },
    { name: "F4", shiftType: ShiftType.EARLY, startTime: "08:00", endTime: "12:00", breakMinutes: 0 },
    { name: "F5", shiftType: ShiftType.EARLY, startTime: "08:00", endTime: "14:00", breakMinutes: 30 },
    { name: "F6", shiftType: ShiftType.EARLY, startTime: "06:00", endTime: "09:00", breakMinutes: 0, startTime2: "15:00", endTime2: "20:00", breakMinutes2: 0 },
    { name: "F7", shiftType: ShiftType.EARLY, startTime: "06:00", endTime: "15:00", breakMinutes: 30 },
    { name: "S1", shiftType: ShiftType.LATE, startTime: "13:00", endTime: "21:30", breakMinutes: 30 },
    { name: "S2", shiftType: ShiftType.LATE, startTime: "14:30", endTime: "21:30", breakMinutes: 30 },
    { name: "S3", shiftType: ShiftType.LATE, startTime: "16:00", endTime: "20:00", breakMinutes: 0 },
    { name: "S4", shiftType: ShiftType.LATE, startTime: "11:00", endTime: "20:00", breakMinutes: 30 },
    { name: "N",  shiftType: ShiftType.NIGHT, startTime: "21:00", endTime: "06:30", breakMinutes: 30 },
    { name: "N1", shiftType: ShiftType.NIGHT, startTime: "21:00", endTime: "06:00", breakMinutes: 30 },
    { name: "BL", shiftType: ShiftType.BL,    startTime: "08:00", endTime: "16:30", breakMinutes: 30 },
  ];

  const profiles: Record<string, { id: string }> = {};
  for (const pd of profileDefs) {
    const p = await prisma.shiftProfile.create({
      data: {
        facilityId: facility.id,
        name: pd.name,
        shiftType: pd.shiftType,
        startTime: pd.startTime,
        endTime: pd.endTime,
        breakMinutes: pd.breakMinutes,
        startTime2: pd.startTime2 ?? null,
        endTime2: pd.endTime2 ?? null,
        breakMinutes2: pd.breakMinutes2 ?? null,
      },
    });
    profiles[pd.name] = p;
  }

  // ── Staffing Requirements (from real facility specs) ──
  type StaffingDef = {
    shiftType: ShiftType; stationNumber: number;
    minTotalCount: number; maxTotalCount: number | null; isFacilityWide: boolean;
    qualifications: { tag: string; minCount: number }[];
  };
  const staffingDefs: StaffingDef[] = [
    { shiftType: ShiftType.EARLY, stationNumber: 1, minTotalCount: 3, maxTotalCount: 5, isFacilityWide: false,
      qualifications: [{ tag: "PFK", minCount: 1 }, { tag: "APH,KPH,PH", minCount: 2 }] },
    { shiftType: ShiftType.LATE, stationNumber: 1, minTotalCount: 2, maxTotalCount: 2, isFacilityWide: false,
      qualifications: [{ tag: "PFK", minCount: 1 }, { tag: "APH,KPH,PH", minCount: 1 }] },
    { shiftType: ShiftType.EARLY, stationNumber: 2, minTotalCount: 1, maxTotalCount: 1, isFacilityWide: false,
      qualifications: [{ tag: "PFK,APH,KPH,PH", minCount: 1 }] },
    { shiftType: ShiftType.LATE, stationNumber: 2, minTotalCount: 1, maxTotalCount: 1, isFacilityWide: false,
      qualifications: [{ tag: "PFK,APH,KPH,PH", minCount: 1 }] },
    { shiftType: ShiftType.EARLY, stationNumber: 3, minTotalCount: 3, maxTotalCount: 5, isFacilityWide: false,
      qualifications: [{ tag: "PFK", minCount: 1 }, { tag: "APH,KPH,PH", minCount: 2 }] },
    { shiftType: ShiftType.LATE, stationNumber: 3, minTotalCount: 2, maxTotalCount: 3, isFacilityWide: false,
      qualifications: [{ tag: "PFK", minCount: 1 }, { tag: "APH,KPH,PH", minCount: 1 }] },
    { shiftType: ShiftType.NIGHT, stationNumber: 0, minTotalCount: 2, maxTotalCount: 2, isFacilityWide: true,
      qualifications: [{ tag: "PFK", minCount: 1 }, { tag: "APH,KPH,PH", minCount: 1 }] },
  ];

  for (const sd of staffingDefs) {
    await prisma.staffingRequirement.create({
      data: {
        facilityId: facility.id,
        shiftType: sd.shiftType,
        stationNumber: sd.stationNumber,
        minTotalCount: sd.minTotalCount,
        maxTotalCount: sd.maxTotalCount,
        isFacilityWide: sd.isFacilityWide,
        qualificationRequirements: {
          create: sd.qualifications.map((q) => ({
            qualificationTag: q.tag,
            minCount: q.minCount,
          })),
        },
      },
    });
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
      shiftProfileId: profiles["F1"]!.id,
      employeeId: empBen.id,
      createdByUserId: planner.id,
    },
  });

  console.log("Seed OK:", {
    facilityId: facility.id,
    qualifications: qualDefs.map((q) => q.abbreviation).join(", "),
    shiftProfiles: profileDefs.map((p) => p.name).join(", "),
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
