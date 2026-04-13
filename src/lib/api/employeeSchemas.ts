import { z } from "zod";

export const contractTypeZ = z.enum([
  "FULL_TIME",
  "PART_TIME",
  "MINI_JOB",
  "AUSBILDUNG",
]);
export const targetHoursPeriodZ = z.enum(["WEEKLY", "MONTHLY"]);
export const shiftTypeZ = z.enum(["EARLY", "LATE", "NIGHT", "BL"]);
export const employeeStatusZ = z.enum([
  "ACTIVE", "INACTIVE", "KRANK", "LANGZEITKRANK", "MUTTERSCHUTZ", "URLAUB", "KUR",
]);

const targetHoursPercentZ = z.number().positive().max(1000).optional().nullable();

export const employeeCreateSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  workProfileId: z.string().cuid().optional().nullable(),
  contractType: contractTypeZ.optional(),
  status: employeeStatusZ.optional(),
  targetHoursPercent: targetHoursPercentZ,
  miniJobMaxMonthlyHours: z.number().positive().optional().nullable(),
  mainStation: z.number().int().min(1).max(3).optional().nullable(),
  assignedStations: z.array(z.number().int().min(1).max(3)).optional(),
  qualificationTags: z.array(z.string()).optional(),
  qualificationIds: z.array(z.string()).optional(),
  allowedShiftProfileIds: z.array(z.string()).optional(),
  preferredShiftTypes: z.array(shiftTypeZ).optional(),
  isFullTimeBl: z.boolean().optional(),
  fixedWorkingDays: z.array(z.number().int().min(1).max(7)).optional(),
  maxConsecutiveDays: z.number().int().min(1).max(31).optional().nullable(),
  shiftDistribution: z.record(z.string(), z.number().min(0).max(100)).optional().nullable(),
});

export const employeePatchSchema = z
  .object({
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().min(1).max(120).optional(),
    workProfileId: z.string().cuid().optional().nullable(),
    contractType: contractTypeZ.optional(),
    status: employeeStatusZ.optional(),
    targetHoursPercent: targetHoursPercentZ,
    miniJobMaxMonthlyHours: z.number().positive().optional().nullable(),
    mainStation: z.number().int().min(1).max(3).optional().nullable(),
    assignedStations: z.array(z.number().int().min(1).max(3)).optional(),
    qualificationTags: z.array(z.string()).optional(),
    qualificationIds: z.array(z.string()).optional(),
    allowedShiftProfileIds: z.array(z.string()).optional(),
    preferredShiftTypes: z.array(shiftTypeZ).optional(),
    isFullTimeBl: z.boolean().optional(),
    fixedWorkingDays: z.array(z.number().int().min(1).max(7)).optional(),
    maxConsecutiveDays: z.number().int().min(1).max(31).optional().nullable(),
    shiftDistribution: z.record(z.string(), z.number().min(0).max(100)).optional().nullable(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "Mindestens ein Feld zum Aktualisieren angeben",
  });
